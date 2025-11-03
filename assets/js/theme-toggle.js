(function () {
  const THEME_KEY = 'site-theme';
  const LIGHT_THEME = 'light';
  const DARK_THEME = 'dark';

  function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) || LIGHT_THEME;
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    updateThemeIcons(theme);
  }

  function updateThemeIcons(theme) {
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');

    if (lightIcon && darkIcon) {
      if (theme === DARK_THEME) {
        lightIcon.classList.remove('hidden');
        darkIcon.classList.add('hidden');
      } else {
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
      }
    }
  }

  function toggleTheme() {
    const currentTheme = getStoredTheme();
    const newTheme = currentTheme === LIGHT_THEME ? DARK_THEME : LIGHT_THEME;
    setTheme(newTheme);
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTheme(getStoredTheme());
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', toggleTheme);
    }
  });
})();
