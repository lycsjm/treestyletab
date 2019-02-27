/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import {
  log as internalLogger,
  configs
} from './common.js';

import * as Tabs from './tabs.js';

import EventListenerManager from '/extlib/EventListenerManager.js';

function log(...args) {
  internalLogger('common/Window', ...args);
}

export default class Window {
  constructor(windowId) {
    const alreadyTracked = Tabs.trackedWindows.get(windowId);
    if (alreadyTracked)
      return alreadyTracked;

    log(`window ${windowId} is newly tracked`);

    this.id    = windowId;
    this.tabs  = new Map();
    this.order = [];

    this.element = null;

    this.internalMovingTabs  = new Set();
    this.alreadyMovedTabs    = new Set();
    this.internalClosingTabs = new Set();
    this.tabsToBeHighlightedAlone = new Set();

    this.subTreeMovingCount =
      this.subTreeChildrenMovingCount =
      this.doingIntelligentlyCollapseExpandCount =
      this.internalFocusCount =
      this.internalSilentlyFocusCount =
      this.tryingReforcusForClosingActiveTabCount = // used only on Firefox 64 and older
      this.duplicatingTabsCount = 0;

    this.preventAutoGroupNewTabsUntil = Date.now() + configs.autoGroupNewTabsDelayOnNewWindow;

    this.openingTabs   = new Set();

    this.openedNewTabs = [];

    this.toBeOpenedTabsWithPositions = 0;
    this.toBeOpenedOrphanTabs        = 0;

    this.toBeAttachedTabs = new Set();
    this.toBeDetachedTabs = new Set();

    Tabs.trackedWindows.set(windowId, this);
    Tabs.highlightedTabsForWindow.set(windowId, new Set());
  }

  destroy() {
    for (const tab of this.tabs.values()) {
      if (tab.$TST)
        tab.$TST.destroy();
    }
    this.tabs.clear();
    Tabs.trackedWindows.delete(this.id, this);
    Tabs.activeTabForWindow.delete(this.id);
    Tabs.highlightedTabsForWindow.delete(this.id);

    if (this.element) {
      const element = this.element;
      if (element.parentNode && !element.hasChildNodes())
        element.parentNode.removeChild(element);
      delete this.element;
    }

    delete this.tabs;
    delete this.order;
    delete this.id;
  }

  getOrderedTabs(startId, endId) {
    let order = this.order;
    if (startId) {
      if (!this.tabs.has(startId))
        return [];
      order = order.slice(order.indexOf(startId));
    }
    return (function*() {
      for (const id of order) {
        yield this.tabs.get(id);
        if (id == endId)
          break;
      }
    }).call(this);
  }

  getReversedOrderedTabs(startId, endId) {
    let order = this.order.slice(0).reverse();
    if (startId) {
      if (!this.tabs.has(startId))
        return [];
      order = order.slice(order.indexOf(startId));
    }
    return (function*() {
      for (const id of order) {
        yield this.tabs.get(id);
        if (id == endId)
          break;
      }
    }).call(this);
  }

  trackTab(tab) {
    const alreadyTracked = Tabs.trackedTabs.get(tab.id);
    if (alreadyTracked)
      tab = alreadyTracked;

    const order = this.order;
    if (this.tabs.has(tab.id)) { // already tracked: update
      const index = order.indexOf(tab.id);
      order.splice(index, 1);
      order.splice(tab.index, 0, tab.id);
      for (let i = Math.min(index, tab.index), maxi = Math.max(index, tab.index) + 1; i < maxi; i++) {
        this.tabs.get(order[i]).index = i;
      }
      const parent = tab.$TST.parent;
      if (parent)
        parent.$TST.sortChildren();
      log(`tab ${tab.id} is re-tracked under the window ${this.id}: `, order);
    }
    else { // not tracked yet: add
      this.tabs.set(tab.id, tab);
      order.splice(tab.index, 0, tab.id);
      for (let i = tab.index + 1, maxi = order.length; i < maxi; i++) {
        this.tabs.get(order[i]).index = i;
      }
      log(`tab ${tab.id} is newly tracked under the window ${this.id}: `, order);
    }
    return tab;
  }

  detachTab(tabId) {
    const tab = Tabs.trackedTabs.get(tabId);
    if (!tab)
      return;

    tab.$TST.detach();
    this.tabs.delete(tabId);
    const order = this.order;
    const index = order.indexOf(tab.id);
    order.splice(index, 1);
    if (this.tabs.size == 0) {
      this.destroy();
    }
    else {
      for (let i = index, maxi = order.length; i < maxi; i++) {
        this.tabs.get(order[i]).index = i;
      }
    }
    return tab;
  }

  untrackTab(tabId) {
    const tab = this.detachTab(tabId);
    if (tab)
      tab.$TST.destroy();
  }

  export() {
    const tabs = [];
    for (const tab of this.getOrderedTabs()) {
      tabs.push(tab.$TST.export());
    }
    return tabs;
  }
}

Window.onInitialized = new EventListenerManager();

Window.init = windowId => {
  const window = Tabs.trackedWindows.get(windowId) || new Window(windowId);
  Window.onInitialized.dispatch(windowId);
  return window;
}