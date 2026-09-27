(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LittleBotChatScroll = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_BOTTOM_THRESHOLD = 32;

  function nearBottom(scroller, threshold = DEFAULT_BOTTOM_THRESHOLD) {
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= threshold;
  }

  function firstVisibleItem(scroller, host) {
    if (!scroller || !host?.children?.length || typeof scroller.getBoundingClientRect !== 'function') return null;
    const viewport = scroller.getBoundingClientRect();
    for (const child of host.children) {
      if (typeof child?.getBoundingClientRect !== 'function') continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1) return child;
    }
    return null;
  }

  function capture(scroller, host, followTail) {
    if (!scroller) return { followTail: true, anchor: null, anchorOffset: 0 };
    if (followTail) return { followTail: true, anchor: null, anchorOffset: 0 };
    const anchor = firstVisibleItem(scroller, host);
    if (!anchor) return { followTail: false, anchor: null, anchorOffset: 0 };
    const viewport = scroller.getBoundingClientRect();
    return {
      followTail: false,
      anchor,
      anchorOffset: anchor.getBoundingClientRect().top - viewport.top,
    };
  }

  function restore(scroller, state) {
    if (!scroller || !state) return;
    if (state.followTail) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    if (!state.anchor || state.anchor.isConnected === false || typeof state.anchor.getBoundingClientRect !== 'function') return;
    const viewport = scroller.getBoundingClientRect();
    const currentOffset = state.anchor.getBoundingClientRect().top - viewport.top;
    scroller.scrollTop += currentOffset - state.anchorOffset;
  }

  return { DEFAULT_BOTTOM_THRESHOLD, nearBottom, capture, restore };
});
