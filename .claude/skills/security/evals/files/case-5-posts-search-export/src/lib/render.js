const { exec } = require('child_process');

function renderTemplate(templatePath, targetPath) {
  return new Promise((resolve, reject) => {
    exec(
      `wkhtmltopdf ${templatePath} ${targetPath}`,
      { timeout: 30000 },
      (err) => (err ? reject(err) : resolve(targetPath))
    );
  });
}

module.exports = { renderTemplate };
