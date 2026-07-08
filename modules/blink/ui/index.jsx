import BlinkPage from './BlinkPage'

// Blink module — camera live view, motion-triggered clips, manual capture.
// Frontend for the blinkvault sidecar via the /blink proxy.
export default {
  id: 'blink',
  path: '/blink',
  Page: BlinkPage,
}
