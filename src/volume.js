import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

// One wheel notch or arrow press, as a share of the normal maximum.
export const VOLUME_STEP = 0.05;

/**
 * Sets the output volume to `level`, where 1 is the normal maximum, and
 * unmutes when it rises above zero. Clamps to what the sound settings allow
 * (above 100% only if amplification is on). Returns {level, maxLevel} as
 * set, or null without an output. `soundSettings` is org.gnome.desktop.sound.
 */
export function setVolume(level, soundSettings) {
    const control = getMixerControl();
    const sink = control.get_default_sink();
    if (!sink)
        return null;
    const normal = control.get_vol_max_norm();
    const top = soundSettings.get_boolean('allow-volume-above-100-percent')
        ? control.get_vol_max_amplified() : normal;
    const volume = Math.max(0, Math.min(top, level * normal));
    sink.volume = volume;
    if (sink.is_muted && volume > 0)
        sink.change_is_muted(false);
    sink.push_volume();
    return {level: volume / normal, maxLevel: top / normal};
}

// The output volume, where 1 is the normal maximum, or null without one.
export function getVolume() {
    const control = getMixerControl();
    const sink = control.get_default_sink();
    return sink ? sink.volume / control.get_vol_max_norm() : null;
}

// GNOME's own icon for a volume level.
export function volumeIcon(level) {
    let name = 'audio-volume-muted-symbolic';
    if (level > 2 / 3)
        name = 'audio-volume-high-symbolic';
    else if (level > 1 / 3)
        name = 'audio-volume-medium-symbolic';
    else if (level > 0)
        name = 'audio-volume-low-symbolic';
    return new Gio.ThemedIcon({name});
}

// Sets the screen brightness to `level` out of `maxLevel`. Returns the level
// set, or null without a backlight.
export function setBrightness(level, maxLevel) {
    const scale = Main.brightnessManager?.globalScale;
    if (!scale)
        return null;
    scale.value = level / maxLevel;
    return level;
}
