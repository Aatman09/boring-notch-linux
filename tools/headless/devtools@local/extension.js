// Test only: lets the headless test scripts run JavaScript through Shell.Eval.
export default class {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {}
}
