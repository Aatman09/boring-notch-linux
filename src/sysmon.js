import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

const SAMPLE_MS = 1000;
const HWMON = '/sys/class/hwmon';
const THERMAL = '/sys/class/thermal';
// Sensors that read the processor, most preferred first.
const CPU_SENSORS = ['coretemp', 'k10temp', 'zenpower', 'x86_pkg_temp', 'cpu_thermal'];

function readText(path, cancellable = null) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).load_contents_async(cancellable, (file, res) => {
            try {
                const [, contents] = file.load_contents_finish(res);
                resolve(new TextDecoder().decode(contents));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Directories under a sysfs folder, read once when the sensor is looked for.
function listDirs(path) {
    const dir = GLib.Dir.open(path, 0);
    const names = [];
    for (let name = dir.read_name(); name !== null; name = dir.read_name())
        names.push(name);
    return names.map(name => `${path}/${name}`);
}

function readSync(path) {
    try {
        const [, contents] = Gio.File.new_for_path(path).load_contents(null);
        return new TextDecoder().decode(contents).trim();
    } catch {
        return null;
    }
}

// The processor's temperature file, or null when no known sensor exists.
// hwmon and thermal zones name their sensor in a small file; the one with
// the most preferred name wins.
function findCpuSensor() {
    let best = null;
    const consider = (dir, name, file) => {
        const rank = CPU_SENSORS.indexOf(name);
        if (rank !== -1 && (best === null || rank < best.rank))
            best = {rank, path: `${dir}/${file}`};
    };
    try {
        for (const dir of listDirs(HWMON))
            consider(dir, readSync(`${dir}/name`), 'temp1_input');
    } catch {
        // No hwmon on this machine.
    }
    try {
        for (const dir of listDirs(THERMAL))
            consider(dir, readSync(`${dir}/type`), 'temp');
    } catch {
        // No thermal zones on this machine.
    }
    return best?.path ?? null;
}

/**
 * Samples the processor, memory, network and temperature once a second,
 * but only between setActive(true) and setActive(false): the System tab
 * calls it while it is on screen. Each sample is emitted as 'sample' with
 * {cpu (percent), memUsed and memTotal (bytes), down and up (bytes per
 * second), temperature (degrees, or null)}.
 */
export class SystemMonitor extends EventEmitter {
    constructor() {
        super();
        this._active = false;
        this._timeoutId = 0;
        this._cancellable = null;
        this._reading = false;
        this._cpu = null;
        this._net = null;
        this._sensor = undefined;
    }

    setActive(active) {
        if (active === this._active)
            return;
        this._active = active;
        if (active) {
            this._cancellable = new Gio.Cancellable();
            this._cpu = null;
            this._net = null;
            // The first round only takes the counters; rates need two.
            this._sample(true);
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAMPLE_MS, () => {
                this._sample(false);
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
            this._cancellable.cancel();
            this._cancellable = null;
        }
    }

    async _sample(prime) {
        if (this._reading)
            return;
        this._reading = true;
        const cancellable = this._cancellable;
        try {
            const [stat, meminfo, netdev] = await Promise.all([
                readText('/proc/stat', cancellable),
                readText('/proc/meminfo', cancellable),
                readText('/proc/net/dev', cancellable),
            ]);
            if (this._sensor === undefined)
                this._sensor = findCpuSensor();
            const temperature = this._sensor
                ? await readText(this._sensor, cancellable).then(t => Number(t) / 1000, () => null)
                : null;
            if (cancellable.is_cancelled())
                return;

            const now = GLib.get_monotonic_time();
            const cpu = parseCpu(stat);
            const net = parseNet(netdev);
            const mem = parseMemory(meminfo);
            const previousCpu = this._cpu;
            const previousNet = this._net;
            this._cpu = cpu;
            this._net = {...net, time: now};
            if (prime || !previousCpu || !previousNet)
                return;

            const total = cpu.total - previousCpu.total;
            const idle = cpu.idle - previousCpu.idle;
            const seconds = (now - previousNet.time) / 1e6;
            this.emit('sample', {
                cpu: total > 0 ? 100 * (total - idle) / total : 0,
                memUsed: mem.total - mem.available,
                memTotal: mem.total,
                down: Math.max(0, net.rx - previousNet.rx) / seconds,
                up: Math.max(0, net.tx - previousNet.tx) / seconds,
                temperature,
            });
        } catch {
            // A file that cannot be read skips this sample; the next one tries again.
        } finally {
            this._reading = false;
        }
    }

    destroy() {
        this.setActive(false);
    }
}

// The first line of /proc/stat: "cpu user nice system idle iowait ...".
function parseCpu(text) {
    const fields = text.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const [user, nice, system, idle, iowait, irq, softirq, steal] = fields;
    return {
        total: user + nice + system + idle + iowait + irq + softirq + steal,
        idle: idle + iowait,
    };
}

// Lines of /proc/meminfo are "Name:   value kB".
function parseMemory(text) {
    const kb = name => {
        const match = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
        return match ? Number(match[1]) * 1024 : 0;
    };
    return {total: kb('MemTotal'), available: kb('MemAvailable')};
}

// Bytes received and sent by every interface but the loopback, from
// /proc/net/dev (two header lines, then "iface: rx... tx...").
function parseNet(text) {
    let rx = 0;
    let tx = 0;
    for (const line of text.split('\n').slice(2)) {
        const [name, counters] = line.split(':');
        if (!counters || name.trim() === 'lo')
            continue;
        const fields = counters.trim().split(/\s+/).map(Number);
        rx += fields[0];
        tx += fields[8];
    }
    return {rx, tx};
}
