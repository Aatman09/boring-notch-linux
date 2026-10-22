import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// Open-Meteo needs no key. It answers with the current temperature and
// today's high and low at the coordinates in the settings; timezone=auto
// makes "today" mean the place's day.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const REFRESH_US = 30 * 60 * GLib.USEC_PER_SEC;
const REQUEST_TIMEOUT_S = 10;

// The WMO weather codes, as Open-Meteo reports them, as GNOME's icons.
const ICONS = [
    [[0], 'weather-clear-symbolic'],
    [[1, 2], 'weather-few-clouds-symbolic'],
    [[3], 'weather-overcast-symbolic'],
    [[45, 48], 'weather-fog-symbolic'],
    [[51, 53, 55, 56, 57], 'weather-showers-scattered-symbolic'],
    [[61, 63, 65, 66, 67, 80, 81, 82], 'weather-showers-symbolic'],
    [[71, 73, 75, 77, 85, 86], 'weather-snow-symbolic'],
    [[95, 96, 99], 'weather-storm-symbolic'],
];

export const weatherIcon = code =>
    ICONS.find(([codes]) => codes.includes(code))?.[1] ?? 'weather-severe-alert-symbolic';

// The answer as the Today tab shows it: {temperature, icon, high, low}, in
// whole degrees. Throws when the answer has no numbers in it.
const parseForecast = text => {
    const {current, daily} = JSON.parse(text);
    const values = [current.temperature_2m, current.weather_code,
        daily.temperature_2m_max[0], daily.temperature_2m_min[0]];
    if (!values.every(Number.isFinite))
        throw new Error('no temperatures in the forecast');
    const [temperature, code, high, low] = values;
    return {
        temperature: Math.round(temperature),
        icon: weatherIcon(code),
        high: Math.round(high),
        low: Math.round(low),
    };
};

/**
 * The current weather at the location in the settings, for the Today tab.
 * Off unless show-weather is on, and it uses the network, so nothing is
 * asked until refresh() is called, which the Today tab does when it opens.
 * It asks again at most every 30 minutes. Emits 'changed'. `weather` is
 * null while there is no answer: off, no location, or a failed request.
 */
export class WeatherSource extends EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._session = null;
        this._weather = null;
        this._requestedUs = 0;
        this._pending = false;
        // Bumped when the location or the switch changes, so an answer that
        // comes back for the old one is dropped.
        this._generation = 0;

        settings.connectObject(
            'changed::show-weather', () => this._reset(),
            'changed::weather-latitude', () => this._reset(),
            'changed::weather-longitude', () => this._reset(),
            this);
    }

    get weather() {
        return this._weather;
    }

    refresh() {
        const latitude = this._settings.get_double('weather-latitude');
        const longitude = this._settings.get_double('weather-longitude');
        // Both at zero is the unset location, not a place in the sea.
        if (!this._settings.get_boolean('show-weather') || this._pending ||
            (latitude === 0 && longitude === 0))
            return;
        const now = GLib.get_monotonic_time();
        if (this._requestedUs && now - this._requestedUs < REFRESH_US)
            return;

        this._requestedUs = now;
        this._pending = true;
        const generation = this._generation;
        const url = `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
            '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto';
        this._fetch(url)
            .then(text => {
                if (generation === this._generation)
                    this._weather = parseForecast(text);
            })
            .catch(e => {
                if (generation === this._generation && !this._cancellable.is_cancelled()) {
                    this._weather = null;
                    console.warn(`Boring Notch: no weather: ${e.message}`);
                }
            })
            .finally(() => {
                if (generation !== this._generation)
                    return;
                this._pending = false;
                this.emit('changed');
            });
    }

    // Resolves with the body of the answer. Tests replace this to run
    // without the network.
    _fetch(url) {
        this._session ??= new Soup.Session({timeout: REQUEST_TIMEOUT_S});
        const message = Soup.Message.new('GET', url);
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.get_status()}`);
                    resolve(new TextDecoder().decode(bytes.get_data()));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _reset() {
        this._generation++;
        this._weather = null;
        this._requestedUs = 0;
        this._pending = false;
        this.emit('changed');
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._cancellable.cancel();
        this._session = null;
        this.disconnectAll();
    }
}
