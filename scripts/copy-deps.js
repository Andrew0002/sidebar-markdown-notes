const fs = require('fs');
const path = require('path');

// Copy highlight.js library file (v11 uses lib/core.js)
const hlSrc = path.join(__dirname, '../node_modules/highlight.js/lib/core.js');
const hlDest = path.join(__dirname, '../media/lib/highlight.min.js');

if (fs.existsSync(hlSrc)) {
  fs.copyFileSync(hlSrc, hlDest);
  console.log('✓ Copied highlight.js to media/lib');
  
  // Also copy language files
  const langSrc = path.join(__dirname, '../node_modules/highlight.js/lib/languages');
  const langDest = path.join(__dirname, '../media/lib/languages');
  if (!fs.existsSync(langDest)) {
    fs.mkdirSync(langDest, { recursive: true });
  }
  fs.cpSync(langSrc, langDest, { recursive: true });
  console.log('✓ Copied highlight.js languages to media/lib');
} else {
  console.warn('✗ highlight.js not found in node_modules');
}

// Copy a highlight.js theme (using atom-one-dark for dark backgrounds)
const themeSrc = path.join(__dirname, '../node_modules/highlight.js/styles/atom-one-dark.css');
const themeDest = path.join(__dirname, '../media/highlight-theme.css');

if (fs.existsSync(themeSrc)) {
  fs.copyFileSync(themeSrc, themeDest);
  console.log('✓ Copied highlight.js theme to media');
} else {
  console.warn('✗ highlight.js theme not found');
}
