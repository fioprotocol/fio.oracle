export const replaceNewLines = (stringValue, replaceChar = ', ') => {
  return stringValue.replace(/(?:\r\n|\r|\n)/g, replaceChar);
};

export const checkHttpResponseStatus = async (
  response,
  additionalErrorMessage = null
) => {
  if (response.ok) {
    // response.status >= 200 && response.status < 300
    return response;
  } else {
    if (additionalErrorMessage) console.log(additionalErrorMessage);
    const errorBody = await response.text();
    throw new Error(errorBody);
  }
};

export const handleBackups = async (callback, isRetry, backupParams) => {
  try {
    if (isRetry && backupParams) return await callback(backupParams);
    return await callback();
  } catch (error) {
    if (backupParams && !isRetry) {
      return await handleBackups(callback, true, backupParams);
    } else {
      throw error;
    }
  }
};
