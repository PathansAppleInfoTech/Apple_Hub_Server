// Generates order numbers in the form PA-XXXXXX (timestamp + random digits)
// so they're human-readable and effectively unique without an extra query.

function generateOrderNumber() {
  const timestampPart = Date.now().toString().slice(-6);
  const randomPart = Math.floor(100 + Math.random() * 900); // 3 digits
  return `PA-${timestampPart}${randomPart}`;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { generateOrderNumber, slugify };
