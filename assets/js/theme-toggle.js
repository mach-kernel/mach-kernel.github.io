// Theme toggle functionality
(function() {
  const THEME_KEY = 'site-theme';
  const LIGHT_THEME = 'light';
  const DARK_THEME = 'dark';

  // Get theme from localStorage or default to light
  function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) || LIGHT_THEME;
  }

  // Set theme on document
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    updateThemeIcons(theme);
  }

  // Update icon visibility based on current theme
  function updateThemeIcons(theme) {
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');

    if (lightIcon && darkIcon) {
      if (theme === DARK_THEME) {
        // In dark mode, show sun icon (to switch to light)
        lightIcon.classList.remove('hidden');
        darkIcon.classList.add('hidden');
      } else {
        // In light mode, show moon icon (to switch to dark)
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
      }
    }
  }

  // Toggle between light and dark themes
  function toggleTheme() {
    const currentTheme = getStoredTheme();
    const newTheme = currentTheme === LIGHT_THEME ? DARK_THEME : LIGHT_THEME;
    setTheme(newTheme);
  }

  // Initialize theme on page load
  function initTheme() {
    const theme = getStoredTheme();
    setTheme(theme);
  }

  // Set up event listener when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initTheme();
      const toggleButton = document.getElementById('theme-toggle');
      if (toggleButton) {
        toggleButton.addEventListener('click', toggleTheme);
      }
    });
  } else {
    initTheme();
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', toggleTheme);
    }
  }
})();
