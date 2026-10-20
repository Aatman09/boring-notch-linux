#!/bin/bash
# Opens the notch on a tab and reports frame times during the animation.
# Usage: frames.sh <tab>
. "$(dirname "$(readlink -f "$0")")/common.sh"
"$HERE/eval.sh" 'global.bn.close(); "ok"' >/dev/null; timeout 1.5 tail -f /dev/null
"$HERE/eval.sh" "const GLib = imports.gi.GLib; global.ft = []; let last = GLib.get_monotonic_time(); const t0 = last;
  global.bn.open('$1');
  const id = global.stage.connect('after-paint', () => { const n = GLib.get_monotonic_time();
    global.ft.push((n - last) / 1000); last = n; if (n - t0 > 700000) global.stage.disconnect(id); });
  'ok'" >/dev/null
timeout 1.2 tail -f /dev/null
"$HERE/eval.sh" 'const f = global.ft.slice(1), s = [...f].sort((a, b) => a - b);
  `frames=${f.length} median=${s[s.length >> 1].toFixed(1)}ms worst=${s[s.length - 1].toFixed(1)}ms over20ms=${f.filter(x => x > 20).length}`'
