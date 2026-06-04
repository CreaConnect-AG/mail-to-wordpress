const crypto = require('crypto');

function createExecutionLogger({ context, functionName, request }) {
  const startedAt = Date.now();
  const correlationId = getCorrelationId(request);

  function writeLog(level, eventName, details = {}) {
    const payload = {
      source: 'mail-to-wordpress',
      function_name: functionName,
      invocation_id: context.invocationId || null,
      correlation_id: correlationId,
      event: eventName,
      elapsed_ms: Date.now() - startedAt,
      ...details
    };

    const message = JSON.stringify(removeUndefinedValues(payload));

    if (level === 'error' && context.log?.error) {
      context.log.error(message);
      return;
    }

    if (level === 'warn' && context.log?.warn) {
      context.log.warn(message);
      return;
    }

    if (level === 'info' && context.log?.info) {
      context.log.info(message);
      return;
    }

    if (typeof context.log === 'function') {
      context.log(message);
      return;
    }

    console.log(message);
  }

  return {
    correlationId,

    info(eventName, details = {}) {
      writeLog('info', eventName, details);
    },

    warn(eventName, details = {}) {
      writeLog('warn', eventName, details);
    },

    error(eventName, error, details = {}) {
      writeLog('error', eventName, {
        ...details,
        error_name: error?.name || 'Error',
        error_message: truncateText(error?.message || 'Unbekannter Fehler.', 2000),
        error_stack: truncateText(error?.stack || '', 4000)
      });
    }
  };
}

async function runLoggedStep(stepName, logger, action, details = {}) {
  try {
    return await action();
  } catch (error) {
    error.failedStepName = error.failedStepName || stepName;
    error.alreadyLogged = true;

    logger.error('step_failed', error, {
      step: stepName,
      ...details
    });

    throw error;
  }
}

function getSafeMailDetails(requestBody, senderEmailAddress, sourceText) {
  return {
    sender_domain: getEmailDomain(senderEmailAddress),
    subject_length: String(requestBody?.subject || '').length,
    has_text_body: Boolean(requestBody?.text_body),
    has_html_body: Boolean(requestBody?.html_body),
    source_text_length: sourceText ? String(sourceText).length : undefined
  };
}

function getCorrelationId(request) {
  const headerCorrelationId =
    getHeaderValue(request, 'x-correlation-id') ||
    getHeaderValue(request, 'x-ms-client-request-id') ||
    getHeaderValue(request, 'client-request-id');

  if (headerCorrelationId) {
    return String(headerCorrelationId).slice(0, 120);
  }

  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString('hex');
}

function getHeaderValue(request, headerName) {
  if (!request?.headers) {
    return '';
  }

  if (typeof request.headers.get === 'function') {
    return request.headers.get(headerName) || '';
  }

  return request.headers[headerName] || request.headers[headerName.toLowerCase()] || '';
}

function getEmailDomain(emailAddress) {
  const emailParts = String(emailAddress || '').split('@');
  return emailParts.length === 2 ? emailParts[1].toLowerCase() : '';
}

function truncateText(value, maximumLength) {
  const text = String(value || '');
  return text.length > maximumLength ? `${text.slice(0, maximumLength)}...` : text;
}

function removeUndefinedValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

module.exports = {
  createExecutionLogger,
  runLoggedStep,
  getSafeMailDetails
};