import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';

import {IconTextView} from './closedViews.js';
import {Priority} from './peekQueue.js';
import {UpcomingEvents} from './upcoming.js';
import {formatSeconds} from './widgets.js';

const TIMER_DONE_TIMEOUT_MS = 6000;
// Room beside each activity's icon for its figure, in design pixels: the
// elapsed time, the countdown, "in 15 min", the number of downloads.
const RECORD_SIDE = 52;
const TIMER_SIDE = 52;
const MEETING_SIDE = 84;
const DOWNLOAD_SIDE = 52;
// An app's or another program's activity: its icon, title and bar, then a
// count of the others, or its detail.
const ACTIVITY_SIDE = 150;

/**
 * What keeps running in the closed notch instead of peeking for a moment:
 * the screen recording, a timer, the next meeting, the activities other
 * programs report and downloads, in that order of urgency. (Music is the island's own, below all of these.)
 *
 * The island puts `views` into the closed notch, asks current() which one
 * to show, hands presses on it to press(), and says with setOpen() when the
 * notch opens or closes, since nothing here ticks while it is open. The
 * island is `host`: showPeek(), isOpen, open(tab), peekView and relayout().
 */
export class LiveActivities {
    constructor({settings, sources, eventSource, host}) {
        this._settings = settings;
        this._host = host;
        this._recording = sources.recording;
        this._timer = sources.timer;
        this._stopwatch = sources.stopwatch;
        this._pomodoro = sources.pomodoro;
        this._downloads = sources.downloads;
        this._activities = sources.activities;
        this._launcher = sources.launcher;
        this._activity = null;
        this._recordTickId = 0;
        this._recordStartUs = 0;

        this._recordView = new IconTextView('bn-record-live', RECORD_SIDE);
        this._timerView = new IconTextView('bn-timer-live', TIMER_SIDE);
        this._meetingView = new IconTextView('bn-meeting-live', MEETING_SIDE);
        this._downloadView = new IconTextView('bn-download-live', DOWNLOAD_SIDE);
        this._activityView = new IconTextView('bn-activity-live', ACTIVITY_SIDE);
        this._activityBar = new BarLevel.BarLevel({style_class: 'bn-activity-bar', y_align: Clutter.ActorAlign.CENTER});
        this._activityView.right.insert_child_at_index(this._activityBar, 1);
        this.views = [this._recordView, this._timerView, this._meetingView, this._activityView, this._downloadView];

        this._upcoming = new UpcomingEvents(settings, eventSource);
        this._upcoming.connectObject('changed', () => this._syncMeeting(), this);
        this._recording.connectObject('changed', () => this._onRecordingChanged(), this);
        this._timer.connectObject(
            'changed', () => this.syncTimer(),
            'finished', () => this._onTimerFinished('Done'),
            this);
        this._stopwatch.connectObject('changed', () => this.syncTimer(), this);
        this._pomodoro.connectObject(
            'changed', () => this.syncTimer(),
            'finished', (_p, phase) => this._onTimerFinished(phase === 'work' ? 'Break time' : 'Back to work'),
            this);
        this._downloads.connectObject('changed', () => this._syncDownloads(), this);
        this._activities.connectObject('changed', () => this._syncActivities(), this);
        this._launcher.connectObject('changed', () => this._syncActivities(), this);
        settings.connectObject(
            'changed::show-recording', () => this._syncRecording(),
            'changed::show-downloads', () => host.relayout(),
            'changed::timer-modes', () => this._onTimerModesChanged(),
            this);

        if (this._recording.recording) {
            // A recording that is already running when the extension
            // enables has been going since before we could see it; counting
            // from now is the best honest guess.
            this._recordStartUs = GLib.get_monotonic_time();
        }
        this._syncRecording();
        this.syncTimer();
        this._syncMeeting();
        this._syncDownloads();
        this._syncActivities();
    }

    // The activity to show, or null.
    current() {
        if (this._recording.recording && this._settings.get_boolean('show-recording'))
            return this._recordView;
        if (this._activeTimer())
            return this._timerView;
        if (this._upcoming.event)
            return this._meetingView;
        // A download that an app reports through LauncherEntry shows as that
        // app's activity, with its progress, so the download count waits.
        if (this._activity)
            return this._activityView;
        if (this._downloads.count > 0 && this._settings.get_boolean('show-downloads'))
            return this._downloadView;
        return null;
    }

    // Handles a click on `view` and returns true if it was one of ours.
    press(view) {
        // A click stops the recording, like GNOME's own recording indicator.
        if (view === this._recordView) {
            this._recording.stop();
            return true;
        }
        // The countdown opens the Today tab, where the event is listed.
        if (view === this._meetingView) {
            this._host.open('today');
            return true;
        }
        return false;
    }

    // While the notch is open nobody sees the activities, so the recording
    // time and the meeting countdown stop counting.
    setOpen(open) {
        this._upcoming.shown = !open;
        this._syncRecordTick();
    }

    _onRecordingChanged() {
        if (this._recording.recording)
            this._recordStartUs = GLib.get_monotonic_time();
        this._syncRecording();
    }

    _syncRecording() {
        this._syncRecordView();
        this._syncRecordTick();
        this._host.relayout();
    }

    _syncRecordView() {
        const seconds = Math.floor((GLib.get_monotonic_time() - this._recordStartUs) / GLib.USEC_PER_SEC);
        this._recordView.update({iconName: 'media-record-symbolic', title: formatSeconds(seconds)});
    }

    // The elapsed time ticks once a second, only while a recording is on,
    // shown, and the notch is closed.
    _syncRecordTick() {
        const tick = this._recording.recording && !this._host.isOpen &&
            this._settings.get_boolean('show-recording');
        if (tick && !this._recordTickId) {
            this._recordTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._syncRecordView();
                this._host.relayout();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!tick) {
            this._stopRecordTick();
        }
    }

    _stopRecordTick() {
        if (this._recordTickId) {
            GLib.source_remove(this._recordTickId);
            this._recordTickId = 0;
        }
    }

    // The countdown, stopwatch or Pomodoro that is running or paused.
    // Starting one resets the others, so there is at most one.
    _activeTimer() {
        return [this._timer, this._stopwatch, this._pomodoro].find(t => t.active) ?? null;
    }

    // The timer view doubles as the "done" peek; while that shows, it is
    // left alone, and the island calls this again when the peek ends.
    syncTimer() {
        if (this._host.peekView === this._timerView)
            return;
        const timer = this._activeTimer();
        this._timerView.update({
            iconName: timer === this._stopwatch ? 'preferences-system-time-symbolic' : 'alarm-symbolic',
            title: formatSeconds(timer?.seconds ?? 0),
        });
        this._host.relayout();
    }

    _onTimerFinished(title) {
        global.display.get_sound_player().play_from_theme('complete', 'Timer done', null);
        if (this._host.isOpen)
            return;
        this._host.showPeek({
            view: this._timerView,
            apply: () => this._timerView.update({iconName: 'alarm-symbolic', title}),
            timeout: TIMER_DONE_TIMEOUT_MS,
            action: () => this._host.open('timer'),
            priority: Priority.NOTIFICATION,
            key: 'timer',
        });
    }

    // With the modes switched off, a stopwatch or Pomodoro left running
    // would tick unseen, so it is stopped.
    _onTimerModesChanged() {
        if (this._settings.get_boolean('timer-modes'))
            return;
        this._stopwatch.reset();
        this._pomodoro.reset();
    }

    // "in 12 min" while the next event starts within the window.
    _syncMeeting() {
        const event = this._upcoming.event;
        this._meetingView.update({
            iconName: 'x-office-calendar-symbolic',
            title: event ? `in ${this._upcoming.minutesLeft} min` : '',
        });
        this._host.relayout();
    }

    _syncDownloads() {
        const count = this._downloads.count;
        this._downloadView.update({
            iconName: 'folder-download-symbolic',
            title: count > 1 ? `${count}` : '',
        });
        this._host.relayout();
    }

    // The most recent activity from the D-Bus API or from LauncherEntry is
    // shown, with a count of the others; its bar follows its progress.
    _syncActivities() {
        const [latest, ...others] = [...this._activities.list, ...this._launcher.list]
            .sort((a, b) => b.updated - a.updated);
        this._activity = latest ?? null;
        if (latest) {
            this._activityView.update({
                icon: latest.icon,
                title: latest.title,
                body: others.length > 0 ? `+${others.length}` : latest.detail,
            });
            this._activityBar.visible = latest.progress >= 0;
            this._activityBar.value = Math.max(latest.progress, 0);
        }
        this._host.relayout();
    }

    destroy() {
        this._stopRecordTick();
        this._upcoming.destroy();
        for (const source of [this._recording, this._timer, this._stopwatch,
            this._pomodoro, this._downloads, this._activities, this._launcher, this._settings])
            source.disconnectObject(this);
    }
}
