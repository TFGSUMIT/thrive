// modules/calendar/ui/index.jsx — Calendar module UI registration (build-time discovered)
import CalendarPage from './CalendarPage'
import CalendarPanel from './CalendarPanel'

export default {
  id: 'calendar',
  path: '/calendar',
  Page: CalendarPage,
  settings: { title: 'Calendar', defaultOpen: true, Panel: CalendarPanel },
}
