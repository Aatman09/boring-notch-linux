import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {formatSeconds, iconButton} from './widgets.js';

const TIMER_PRESETS = [1, 5, 10, 15, 25];
const TIMER_MODES = [
    {id: 'timer', label: 'Timer'},
    {id: 'stopwatch', label: 'Stopwatch'},
    {id: 'pomodoro', label: 'Pomodoro'},
];

/** The Timer tab: a countdown with presets, a stopwatch or a Pomodoro, then
 *  start, pause and reset. Starting one mode stops the others. */
export const TimerView = GObject.registerClass(
class TimerView extends St.BoxLayout {
    _init({settings, timer, stopwatch, pomodoro}) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-timer',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._settings = settings;
        this._models = {timer, stopwatch, pomodoro};
        this._selected = 'timer';
        this._minutes = 5;

        this._time = new St.Label({style_class: 'bn-timer-time', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._time);

        const modes = new St.BoxLayout({style_class: 'bn-timer-presets', x_align: Clutter.ActorAlign.CENTER});
        this._modeChips = new Map(TIMER_MODES.map(({id, label}) => {
            const button = new St.Button({style_class: 'bn-chip', label, can_focus: true});
            button.connect('clicked', () => {
                this._selected = id;
                this._sync();
            });
            modes.add_child(button);
            return [id, button];
        }));
        this._modeRow = modes;
        this.add_child(modes);

        const presets = new St.BoxLayout({style_class: 'bn-timer-presets', x_align: Clutter.ActorAlign.CENTER});
        this._presets = new Map(TIMER_PRESETS.map(minutes => {
            const button = new St.Button({style_class: 'bn-chip', label: `${minutes} min`, can_focus: true});
            button.connect('clicked', () => {
                this._minutes = minutes;
                this._start();
            });
            presets.add_child(button);
            return [minutes, button];
        }));
        this._presetRow = presets;
        this.add_child(presets);

        this._phase = new St.Label({style_class: 'bn-timer-phase', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._phase);

        const controls = new St.BoxLayout({style_class: 'bn-controls', x_align: Clutter.ActorAlign.CENTER});
        this._playPause = iconButton('media-playback-start-symbolic', 'bn-play', () => {
            const model = this._model;
            if (model.running)
                model.pause();
            else if (model.active)
                model.resume();
            else
                this._start();
        });
        this._reset = iconButton('view-refresh-symbolic', '', () => this._model.reset());
        controls.add_child(this._playPause);
        controls.add_child(this._reset);
        this.add_child(controls);

        for (const model of Object.values(this._models))
            model.connectObject('changed', () => this._sync(), this);
        settings.connectObject(
            'changed::timer-modes', () => this._sync(),
            'changed::pomodoro-work-minutes', () => this._sync(),
            this);
        this._sync();
    }

    // Only the countdown while the modes are switched off in the settings.
    get _mode() {
        return this._settings.get_boolean('timer-modes') ? this._selected : 'timer';
    }

    get _model() {
        return this._models[this._mode];
    }

    // Starting one mode resets the others, wherever the start comes from.
    _start() {
        if (this._mode === 'timer')
            this._models.timer.start(this._minutes * 60);
        else
            this._model.start();
    }

    // What the time reads when nothing runs: the chosen countdown, the
    // Pomodoro's work length, or zero for the stopwatch.
    _idleSeconds() {
        if (this._mode === 'timer')
            return this._minutes * 60;
        if (this._mode === 'pomodoro')
            return this._settings.get_int('pomodoro-work-minutes') * 60;
        return 0;
    }

    _sync() {
        const mode = this._mode;
        const model = this._model;
        this._time.text = formatSeconds(model.active ? model.seconds : this._idleSeconds());
        this._playPause.child.icon_name = model.running
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._reset.reactive = model.active;

        this._modeRow.visible = this._settings.get_boolean('timer-modes');
        for (const [id, button] of this._modeChips)
            button.checked = id === mode;

        this._presetRow.visible = mode === 'timer';
        const selected = model.active ? Math.round(this._models.timer.duration / 60) : this._minutes;
        for (const [minutes, button] of this._presets)
            button.checked = minutes === selected;
        this._phase.visible = mode === 'pomodoro';
        if (mode === 'pomodoro')
            this._phase.text = model.phase === 'break' ? 'Break' : 'Work';
    }
});
