// Copy code block functionality
document.addEventListener('DOMContentLoaded', function() {
  // Find all copy buttons
  const copyButtons = document.querySelectorAll('[data-copy-code]');

  copyButtons.forEach(function(button) {
    button.addEventListener('click', function() {
      // Find the code element (next sibling's code child)
      const wrapper = button.closest('.code-block-wrapper');
      const codeElement = wrapper.querySelector('code');
      const code = codeElement.textContent;

      navigator.clipboard.writeText(code).then(function() {
        // Success feedback
        button.textContent = 'Copied!';
        button.classList.add('copied');

        setTimeout(function() {
          button.textContent = 'Copy';
          button.classList.remove('copied');
        }, 2000);
      }).catch(function(err) {
        console.error('Failed to copy code:', err);
        button.textContent = 'Failed';
        setTimeout(function() {
          button.textContent = 'Copy';
        }, 2000);
      });
    });
  });
});
