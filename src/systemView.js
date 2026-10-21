import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Thirty samples, one a second: the last half minute.
const SAMPLES = 30;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
// Network bars are scaled to at least this rate, so a quiet link stays flat.
const MIN_RATE_SCALE = 64 * 1024;

function formatRate(bytes) {
    if (bytes >= MIB)
        return `${(bytes / MIB).toFixed(1)} MB/s`;
    if (bytes >= 1024)
        return `${Math.round(bytes / 1024)} KB/s`;
    return `${Math.round(bytes)} B/s`;
}

function valueLabel() {
    return new St.Label({style_class: 'bn-system-value'});
}

// A column of the page: its title, then the given children.
function column(title, ...children) {
    const box = new St.BoxLayout({
        style_class: 'bn-system-column',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    box.add_child(new St.Label({style_class: 'bn-system-title', text: title}));
    children.forEach(child => box.add_child(child));
    return box;
}

// Bars are placed by hand, one slot per sample with the newest on the
// right, so a new sample only needs a relayout.
const SparkLayout = GObject.registerClass(
class SparkLayout extends Clutter.LayoutManager {
    vfunc_allocate(container, box) {
        const {_values: values, _max: max} = container;
        const slot = box.get_width() / SAMPLES;
        const height = box.get_height();
        const offset = SAMPLES - values.length;
        container.get_children().forEach((bar, i) => {
            const fraction = i < offset ? 0 : Math.min(1, values[i - offset] / max);
            const x1 = Math.round(box.x1 + i * slot);
            const x2 = Math.round(box.x1 + (i + 1) * slot);
            const barHeight = Math.round(fraction * height);
            const barBox = new Clutter.ActorBox();
            barBox.set_origin(x1, box.y1 + height - barHeight);
            barBox.set_size(Math.max(1, x2 - x1 - 1), barHeight);
            bar.allocate(barBox);
        });
    }
});

const Sparkline = GObject.registerClass(
class Sparkline extends St.Widget {
    _init() {
        super._init({style_class: 'bn-sysmon-spark', x_expand: true, layout_manager: new SparkLayout()});
        this._values = [];
        this._max = 1;
        for (let i = 0; i < SAMPLES; i++)
            this.add_child(new St.Widget({style_class: 'bn-sysmon-bar'}));
    }

    setValues(values, max) {
        this._values = values;
        this._max = max;
        this.queue_relayout();
    }
});

/**
 * The System tab: processor, memory, network and temperature, each with
 * its last half minute as small bars. The samples come from SystemMonitor,
 * which only runs while this page is on screen.
 */
export const SystemView = GObject.registerClass(
class SystemView extends St.BoxLayout {
    _init({system}) {
        super._init({style_class: 'bn-system', x_expand: true, y_expand: true});
        this._history = {cpu: [], memory: [], down: [], up: []};

        this._cpuLabel = valueLabel();
        this._cpuSpark = new Sparkline();
        this._memoryLabel = valueLabel();
        this._memorySpark = new Sparkline();
        this._downLabel = valueLabel();
        this._downSpark = new Sparkline();
        this._upLabel = valueLabel();
        this._upSpark = new Sparkline();
        this._temperatureLabel = valueLabel();
        // Only shown when a processor temperature sensor exists.
        this._temperatureBox = column('Temperature', this._temperatureLabel);
        this._temperatureBox.visible = false;

        this.add_child(column('Processor', this._cpuLabel, this._cpuSpark));
        this.add_child(column('Memory', this._memoryLabel, this._memorySpark));
        this.add_child(column('Network', this._downLabel, this._downSpark, this._upLabel, this._upSpark));
        this.add_child(this._temperatureBox);

        system.connectObject('sample', (_system, sample) => this._show(sample), this);
        this.reset();
    }

    // Starts again from nothing, as the tab does each time it is opened.
    reset() {
        for (const list of Object.values(this._history))
            list.length = 0;
        for (const label of [this._cpuLabel, this._memoryLabel, this._downLabel, this._upLabel])
            label.text = '—';
        this._sync();
    }

    _show({cpu, memUsed, memTotal, down, up, temperature}) {
        this._push('cpu', cpu);
        this._push('memory', 100 * memUsed / memTotal);
        this._push('down', down);
        this._push('up', up);
        this._cpuLabel.text = `${Math.round(cpu)}%`;
        this._memoryLabel.text = `${(memUsed / GIB).toFixed(1)} of ${(memTotal / GIB).toFixed(1)} GB`;
        this._downLabel.text = `↓ ${formatRate(down)}`;
        this._upLabel.text = `↑ ${formatRate(up)}`;
        this._temperatureBox.visible = temperature !== null;
        if (temperature !== null)
            this._temperatureLabel.text = `${Math.round(temperature)} °C`;
        this._sync();
    }

    _push(name, value) {
        const list = this._history[name];
        list.push(value);
        if (list.length > SAMPLES)
            list.shift();
    }

    _sync() {
        const {cpu, memory, down, up} = this._history;
        const rateMax = Math.max(MIN_RATE_SCALE, ...down, ...up);
        this._cpuSpark.setValues(cpu, 100);
        this._memorySpark.setValues(memory, 100);
        this._downSpark.setValues(down, rateMax);
        this._upSpark.setValues(up, rateMax);
    }
});
