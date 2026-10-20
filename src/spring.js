import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

// Integration step. Small enough that stiff springs stay stable.
const STEP = 1 / 480;
// Longest frame we integrate in one go, so a stalled frame does not make the
// notch jump.
const MAX_FRAME = 1 / 20;
const REST_DELTA = 0.05;

/**
 * A damped spring with the same parameters as SwiftUI's
 * `.spring(response:dampingFraction:)`, so values copied from boring.notch
 * behave the same way.
 */
export class Spring {
    constructor(value) {
        this.value = value;
        this.target = value;
        this.velocity = 0;
        this.configure({response: 0.4, damping: 1});
    }

    configure({response, damping}) {
        const omega = 2 * Math.PI / response;
        this._stiffness = omega * omega;
        this._damping = 2 * damping * omega;
    }

    step(dt) {
        for (let left = dt; left > 0; left -= STEP) {
            const h = Math.min(STEP, left);
            const force = -this._stiffness * (this.value - this.target) -
                this._damping * this.velocity;
            this.velocity += force * h;
            this.value += this.velocity * h;
        }
    }

    get atRest() {
        return Math.abs(this.value - this.target) < REST_DELTA &&
            Math.abs(this.velocity) < REST_DELTA;
    }

    snap() {
        this.value = this.target;
        this.velocity = 0;
    }
}

/**
 * Drives a set of springs from the frame clock of `actor` and calls
 * `onFrame` after every step until they all come to rest.
 */
export class SpringAnimator {
    constructor(actor, springs, onFrame) {
        this._actor = actor;
        this._springs = springs;
        this._onFrame = onFrame;
        this._timeline = new Clutter.Timeline({
            actor,
            duration: 1000,
            repeat_count: -1,
        });
        this._timeline.connect('new-frame', () => this._tick());
    }

    start() {
        // Jump straight to the end without animations, or before the actor
        // is on the stage and has a frame clock to animate with.
        if (!St.Settings.get().enable_animations || !this._actor.get_stage()) {
            this._springs.forEach(s => s.snap());
            this._onFrame();
            return;
        }

        if (this._timeline.is_playing())
            return;

        this._last = GLib.get_monotonic_time();
        this._timeline.start();
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        const dt = Math.min((now - this._last) / GLib.USEC_PER_SEC, MAX_FRAME);
        this._last = now;

        this._springs.forEach(s => s.step(dt));

        if (this._springs.every(s => s.atRest)) {
            this._springs.forEach(s => s.snap());
            this._timeline.stop();
        }

        this._onFrame();
    }

    destroy() {
        this._timeline.stop();
        this._timeline = null;
    }
}
