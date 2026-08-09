// kuhul-es/runtime/src/browser.js
//
// Browser adapter around the isomorphic KUHUL runtime core.
// Adds DOM/CSS-VER integration and window global exports.

'use strict';

import { KUHULRuntimeCore } from './core.mjs';

class KUHULRuntimeBrowser extends KUHULRuntimeCore {
  constructor() {
    super({ delayMs: 16 });
    this.cssVER = new CSSVER();
  }
}

// CSS-VER Integration
class CSSVER {
  constructor() {
    this.agents = new Map();
    this.cssVariables = new Map();
  }

  createAgent(element, bodyId) {
    const agent = {
      element,
      bodyId,
      cssVars: new Map([
        ['--π-x', '0px'],
        ['--π-y', '0px'],
        ['--π-scale', '1'],
        ['--π-rotation', '0deg'],
      ]),
    };

    this.agents.set(bodyId, agent);
    this.updateElement(agent);
    return agent;
  }

  updateFromPhysics(body) {
    const agent = this.agents.get(body.id);
    if (agent) {
      agent.cssVars.set('--π-x', `${body.x}px`);
      agent.cssVars.set('--π-y', `${body.y}px`);
      this.updateElement(agent);
    }
  }

  updateElement(agent) {
    for (const [prop, value] of agent.cssVars) {
      agent.element.style.setProperty(prop, value);
    }
  }
}

if (typeof window !== 'undefined') {
  window.KUHULRuntime = KUHULRuntimeBrowser;
  window.CSSVER = CSSVER;
}

export { KUHULRuntimeBrowser as KUHULRuntime, CSSVER };
