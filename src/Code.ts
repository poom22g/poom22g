function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu('Custom Tools')
    .addItem('Say Hello', 'sayHello')
    .addToUi();
}

function sayHello(): void {
  SpreadsheetApp.getUi().alert('Hello from Apps Script!');
}
