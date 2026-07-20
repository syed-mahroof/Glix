// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname, {
  // Enable CSS support in Metro for web
  isCSSEnabled: true,
});

module.exports = config;
