# The tour: music in the closed notch, opening it, the tabs, and a new
# track peeking out.
AREA="360 0 1200 700"
LENGTH=24

setup() {
    player cover-golden.png "Golden Hour Drive@Nova Lane|Paper Planes at Dusk@The Sundial Club"
    js 'global.demo.events([[35, 30, "Design review"], [150, 45, "Gym"], [330, 90, "Dinner with Sam"], [-120, 60, "Standup"]])'
    js 'global.demo.weather({current: {temperature_2m: 23.6, weather_code: 1}, daily: {temperature_2m_max: [27.2], temperature_2m_min: [17.8]}})'
    setting string weather-place "'Lisbon'"
    setting double weather-latitude 38.72
    setting double weather-longitude -9.14
    setting boolean show-weather true
    notify Messages mail-unread-symbolic "Maya" "Lunch at 1? I found a new ramen place"
    notify Calendar x-office-calendar-symbolic "Design review in 35 minutes" "Room 4 and online"
    pause 1
    js 'global.bn._clearPeeks()'
    js 'global.demo.move(960, 820, 10)'
    pause 3
}

scene() {
    pause 2.2
    move 960 16 800
    pause 1.4
    move 1010 170 500
    pause 2.6
    tab today
    pause 3.2
    tab timer
    pause 1.6
    tab home
    pause 1
    move 980 820 700
    pause 1.6
    js 'global.bn._media.activePlayer.next()'
    pause 4
}
