// Lightweight, dependency-free request validation.
// Usage: router.post('/', validate({ title: 'required', price: 'required|number' }), handler)

const { error } = require('../utils/apiResponse');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkRule(value, rule) {
  switch (rule) {
    case 'required':
      return value !== undefined && value !== null && String(value).trim() !== '';
    case 'number':
      return value === undefined || value === '' || !Number.isNaN(Number(value));
    case 'email':
      return value === undefined || value === '' || EMAIL_RE.test(value);
    default:
      return true;
  }
}

function validate(schema) {
  return (req, res, next) => {
    const errors = {};

    for (const [field, ruleStr] of Object.entries(schema)) {
      const rules = ruleStr.split('|');
      const value = req.body[field];

      for (const rule of rules) {
        if (!checkRule(value, rule)) {
          errors[field] = errors[field] || `Invalid value for "${field}" (${rule})`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return error(res, 'Validation failed', 422, errors);
    }

    next();
  };
}

module.exports = { validate };
