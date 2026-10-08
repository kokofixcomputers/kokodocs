/** The edges of what is really visible. On an iPhone the on-screen keyboard covers the bottom of the page without making the page
 *  any shorter (window.innerHeight stays the same), so menus placed by window size end up underneath it. */
export const viewBottom = () => { const v = window.visualViewport; return v ? v.offsetTop + v.height : window.innerHeight }
export const viewRight = () => { const v = window.visualViewport; return v ? v.offsetLeft + v.width : window.innerWidth }
