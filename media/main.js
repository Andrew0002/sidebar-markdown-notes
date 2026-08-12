/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-undef */
// @ts-nocheck

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
  // Gets the vs code api
  const vscode = acquireVsCodeApi();

  const log = (message) => vscode.postMessage({ type: 'log', value: message });

  const updateStatusBar = (message) => vscode.postMessage({ type: 'updateStatusBar', value: message });
  updateStatusBar('');

  let timeoutId;
  const updateStatusForSeconds = (message, secondsToHide) => {
    updateStatusBar(message);

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }

    timeoutId = setTimeout(() => {
      updateStatusBar('');
    }, secondsToHide || 3000);
  };

  const initialState = {
    state: 'editor',
    currentPage: 0,
    pages: [''],
    version: 1
  };

  // Gets the state or creates a new one if it doesn't exist
  let currentState = vscode.getState() || initialState;

  // Define a highlight function that uses highlight.js if available
  const highlightCode = (code, lang) => {
    if (typeof hljs !== 'undefined') {
      try {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      } catch (e) {
        return code;
      }
    }
    return code;
  };

  // Set the options for the marked markdown parser
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight: highlightCode
  });

  // Creates custom renderers for the marked markdown
  const renderer = {
    // Ref: https://github.com/markedjs/marked/blob/master/src/Renderer.js
    list(body, ordered, start) {
      const type = ordered ? 'ol' : 'ul',
        startatt = ordered && start !== 1 ? ' start="' + start + '"' : '',
        hasTodo = body.match(/checkbox/i) ? ' class="todoList"' : ''; // If there's a checkbox, adds a "todoList" class
      return '<' + type + startatt + hasTodo + '>\n' + body + '</' + type + '>\n';
    },
    checkbox(checked) {
      return '<input ' + (checked ? 'checked="" ' : '') + 'type="checkbox"' + (this.options.xhtml ? ' /' : '') + '> ';
    }
  };

  // Use the created renderer
  marked.use({ renderer });

  const taskItemPattern = /^(\s*)([-+*]|\d+[.)])\s+\[([ xX])\](\s+.*)?$/;

  const getTaskLineIndexByOrdinal = (markdown, taskOrdinal) => {
    const lines = markdown.split('\n');
    let foundTaskCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (taskItemPattern.test(lines[i])) {
        if (foundTaskCount === taskOrdinal) {
          return i;
        }
        foundTaskCount += 1;
      }
    }

    return -1;
  };

  const isTaskLineChecked = (line) => /\[[xX]\]/.test(line);

  const toggleTaskLine = (line, checked) => line.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');

  // This method will render the webview
  const renderView = () => {
    // Grabs the elements
    const renderElement = document.getElementById('render');
    const editorElement = document.getElementById('content');

    // Gets the latest markdown content
    const content = currentState.pages[currentState.currentPage];

    switch (currentState.state) {
      case 'render': {
        // If we want to render the markdown

        // Grab the html for the markdown
        renderElement.innerHTML = DOMPurify.sanitize(marked(content || ''));

        if (renderElement.classList.contains('hidden')) {
          renderElement.classList.remove('hidden');
        }
        editorElement.classList.add('hidden');

        document.querySelectorAll(`input[type='checkbox']`).forEach((check, taskOrdinal) => {
          const initialMarkdown = currentState.pages[currentState.currentPage] || '';
          const initialLines = initialMarkdown.split('\n');
          const initialLineIndex = getTaskLineIndexByOrdinal(initialMarkdown, taskOrdinal);

          if (initialLineIndex >= 0) {
            check.checked = isTaskLineChecked(initialLines[initialLineIndex] || '');
          }

          check.addEventListener('click', () => {
            const markdownContent = currentState.pages[currentState.currentPage] || '';
            const lines = markdownContent.split('\n');
            const taskLineIndex = getTaskLineIndexByOrdinal(markdownContent, taskOrdinal);

            if (taskLineIndex < 0) {
              return;
            }

            const currentLine = lines[taskLineIndex];
            if (!currentLine) {
              return;
            }

            const nextChecked = !isTaskLineChecked(currentLine);
            lines[taskLineIndex] = toggleTaskLine(currentLine, nextChecked);
            const newPageContent = lines.join('\n');

            const newState = {
              ...currentState,
              pages: [
                ...currentState.pages.slice(0, currentState.currentPage),
                newPageContent,
                ...currentState.pages.slice(currentState.currentPage + 1)
              ]
            };

            saveState(newState);
          });
        });
        break;
      }
      case 'editor': {
        // If we want to render the text editor

        // Grabs the text input
        const editorTextArea = document.getElementById('text-input');

        // Put the value in the input
        editorTextArea.value = content || '';

        if (editorElement.classList.contains('hidden')) {
          editorElement.classList.remove('hidden');
        }
        renderElement.classList.add('hidden');
        break;
      }
    }
  };

  const saveState = (newState) => {
    // Save to webview state (for same-session persistence)
    vscode.setState(newState);
    // Save to disk via extension
    vscode.postMessage({ type: 'saveData', value: newState });
    // Updates current instance
    currentState = newState;

    renderView();
  };

  const getUpdatedContent = () => {
    let newState = { ...currentState };

    switch (currentState.state) {
      case 'render': {
        break;
      }
      case 'editor': {
        // If the current state is the editor

        // Get the editor text area
        const editorTextArea = document.getElementById('text-input');

        // Updates the value in state only if they're different
        if (editorTextArea.value !== newState.pages[newState.currentPage]) {
          // Make a state with the typed in value
          newState = {
            ...newState,
            pages: [
              ...newState.pages.slice(0, newState.currentPage),
              editorTextArea.value,
              ...newState.pages.slice(newState.currentPage + 1)
            ]
          };
        }

        break;
      }
    }

    return newState;
  };

  const debouncedSaveContent = _.debounce(() => saveState(getUpdatedContent()), 300, {
    maxWait: 500
  });

  const togglePreview = () => {
    // Grabs the new state
    let newState = { ...getUpdatedContent(), state: currentState.state === 'editor' ? 'render' : 'editor' };
    saveState(newState);
  };

  const exportPage = () => {
    let newState = getUpdatedContent();
    saveState(newState);
    vscode.postMessage({ type: 'exportPage', currentPage: newState.currentPage });
  };

  const previousPage = () => {
    if (currentState.currentPage > 0) {
      let newState = { ...getUpdatedContent(), currentPage: currentState.currentPage - 1 };

      saveState(newState);

      updateStatusForSeconds(`$(file) Page ${newState.currentPage + 1}`);
    } else {
      updateStatusForSeconds(`$(file) Page ${currentState.currentPage + 1}`);
      log(`You're already at the first page`);
    }
  };

  const nextPage = () => {
    if (currentState.currentPage <= 999) {
      const newPageIndex = Number(currentState.currentPage) + 1;

      let newState = {
        ...getUpdatedContent(),
        currentPage: newPageIndex
      };

      if (newPageIndex >= newState.pages.length) {
        newState = { ...newState, pages: [...newState.pages, ''] };
      }

      saveState(newState);

      updateStatusForSeconds(`$(file) Page ${newPageIndex + 1}`);
    }
  };

  const deletePage = () => {
    const content = (currentState.pages[currentState.currentPage] || '').trim();
    if (content !== '') {
      log('Can only delete empty pages');
      return;
    }
    if (currentState.pages.length <= 1) {
      log('Cannot delete the last page');
      return;
    }
    const newPages = [...currentState.pages];
    newPages.splice(currentState.currentPage, 1);
    const newPage = Math.min(currentState.currentPage, newPages.length - 1);
    saveState({ ...currentState, pages: newPages, currentPage: newPage });
    updateStatusForSeconds(`$(trash) Deleted page`);
  };

  // Handle messages sent from the extension to the webview
  window.addEventListener('message', (event) => {
    const message = event.data; // The json data that the extension sent
    switch (message.type) {
      case 'togglePreview': {
        // If the editor sends a togglePreview message
        togglePreview();
        break;
      }
      case 'previousPage': {
        previousPage();
        break;
      }
      case 'nextPage': {
        nextPage();
        break;
      }
      case 'resetData': {
        saveState(initialState);
        break;
      }
      case 'exportPage': {
        exportPage();
        break;
      }
      case 'deletePage': {
        deletePage();
        break;
      }
      case 'requestCurrentPage': {
        vscode.postMessage({ type: 'revealCurrentPage', currentPage: currentState.currentPage });
        break;
      }
      case 'loadData': {
        // Loaded from disk by the extension
        const loaded = message.value;
        vscode.setState(loaded);
        currentState = loaded;
        renderView();
        break;
      }
      case 'updatePage': {
        // A specific page was changed externally on disk
        const { pageIndex, content } = message;
        if (pageIndex >= 0 && pageIndex < currentState.pages.length) {
          const newPages = [...currentState.pages];
          newPages[pageIndex] = content;
          currentState = { ...currentState, pages: newPages };
          vscode.setState(currentState);
          if (pageIndex === currentState.currentPage) {
            renderView();
          }
        }
        break;
      }
    }
  });

  document.getElementById('text-input').addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      // prevent the focus lose on tab press
      event.preventDefault();
    }
  });

  document.getElementById('text-input').addEventListener('input', () => {
    debouncedSaveContent();
  });

  // Request state from disk (extension will reply with loadData if a storage directory is configured)
  vscode.postMessage({ type: 'requestLoad' });

  // Runs the render for the first time
  renderView();
})();
