import GObject from 'gi://GObject';
import St from 'gi://St';

// Port of NotchShape.swift (originally from DynamicNotchKit): a rectangle
// whose top corners flare outwards into the top bar and whose bottom corners
// are rounded.
//
// Only the two flared corners are drawn with Cairo, because they are small.
// The body is a plain St background, which the GPU draws, so animating the
// notch's size does not mean redrawing a large surface every frame.

// Cairo only has cubic curves; this draws a quadratic one through them.
function quadTo(cr, [x0, y0], [cx, cy], [x, y]) {
    cr.curveTo(
        x0 + 2 / 3 * (cx - x0), y0 + 2 / 3 * (cy - y0),
        x + 2 / 3 * (cx - x), y + 2 / 3 * (cy - y),
        x, y);
}

// The left corner: the area under the top edge and outside the curve from
// the notch's side up to the screen edge. The extra column on the right
// overlaps the body so no seam shows between them.
function drawCorner(area, mirror) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const r = w - 1;
    if (mirror) {
        cr.translate(w, 0);
        cr.scale(-1, 1);
    }
    cr.moveTo(0, 0);
    cr.lineTo(w, 0);
    cr.lineTo(w, h);
    cr.lineTo(r, h);
    quadTo(cr, [r, h], [r, 0], [0, 0]);
    cr.closePath();
    cr.setSourceRGBA(0, 0, 0, 1);
    cr.fill();
    cr.$dispose();
}

export const NotchShape = GObject.registerClass(
class NotchShape extends St.Widget {
    _init() {
        super._init();
        this._left = new St.DrawingArea();
        this._right = new St.DrawingArea();
        this._body = new St.Widget({style_class: 'bn-notch-body'});
        this._left.connect('repaint', area => drawCorner(area, false));
        this._right.connect('repaint', area => drawCorner(area, true));
        this.add_child(this._body);
        this.add_child(this._left);
        this.add_child(this._right);
        this._bottomRadius = -1;
    }

    // All values are in actor pixels. `cssScale` converts them to CSS
    // pixels for the body's border radius.
    setGeometry(width, height, topRadius, bottomRadius, cssScale) {
        const tr = Math.max(0, Math.min(Math.round(topRadius), Math.floor(width / 4), height));
        const br = Math.max(0, Math.min(bottomRadius, (width - 2 * tr) / 2, height));

        this.set_size(width, height);
        this._left.set_position(0, 0);
        this._left.set_size(tr + 1, tr);
        this._right.set_position(width - tr - 1, 0);
        this._right.set_size(tr + 1, tr);
        this._body.set_position(tr, 0);
        this._body.set_size(Math.max(0, width - 2 * tr), height);

        // St caches rounded corners by radius, so only whole radii are used.
        const radius = Math.round(br / cssScale);
        if (radius !== this._bottomRadius) {
            this._bottomRadius = radius;
            this._body.style = `border-radius: 0 0 ${radius}px ${radius}px;`;
        }
    }
});
