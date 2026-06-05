'use strict';

let configs = {
  'Account Executive': { 
    slider1: 65, 
    slider2: 40, 
    customDirectives: '' 
  },
  'Legal': { 
    slider1: 15, 
    slider2: 5, 
    customDirectives: '' 
  },
  'Resource': { 
    slider1: 50, 
    slider2: 75, 
    customDirectives: '' 
  },
  'Financial': { 
    slider1: 30, 
    slider2: 60, 
    customDirectives: '' 
  },
  'Board of Directors': { 
    slider1: 85, 
    slider2: 90, 
    customDirectives: '' 
  }
};

module.exports = {
  getConfigs: () => configs,
  updateConfigs: (newConfigs) => { 
    configs = { ...configs, ...newConfigs }; 
  }
};
