import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { formatDateForFolder, logAppVersionToSystemLog } from './general.js';
import { LOG_DIRECTORY_PATH_NAME } from './log-file-templates.js';
import { clearLogFiles } from './log-files.js';
import config from '../../config/config.js';

const execAsync = promisify(exec);

const {
  aws: {
    AWS_S3_KEY,
    AWS_S3_SECRET,
    AWS_S3_BUCKET,
    AWS_S3_REGION,
    AWS_S3_PERMITTED_FOLDER,
  },
  mode,
} = config;

/**
 * Initialize S3 client
 */
const createS3Client = () => {
  if (!AWS_S3_KEY || !AWS_S3_SECRET || !AWS_S3_REGION) {
    console.warn('⚠️  AWS S3 credentials not configured. S3 sync will be disabled.');
    return null;
  }

  return new S3Client({
    region: AWS_S3_REGION,
    credentials: {
      accessKeyId: AWS_S3_KEY,
      secretAccessKey: AWS_S3_SECRET,
    },
  });
};

/**
 * Get timestamp for archive filename
 * @returns {string} - Timestamp in format YYYY-MM-DD_HH-mm-ss
 */
const getArchiveTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
};

/**
 * Create a compressed tar.gz archive of the log directory
 * @param {string} logDir - Log directory path
 * @param {string} archivePath - Output archive path
 * @returns {Promise<boolean>} - Success status
 */
const createLogArchive = async (logDir, archivePath) => {
  try {
    // Use tar to create compressed archive
    // -czf: create, gzip, file
    // -C: change to directory
    await execAsync(
      `tar -czf "${archivePath}" -C "${path.dirname(logDir)}" "${path.basename(logDir)}"`,
    );

    return fs.existsSync(archivePath);
  } catch (error) {
    console.error('Failed to create archive:', error.message);
    return false;
  }
};

/**
 * Upload archive to S3
 * @param {Object} params
 * @param {string} params.archivePath - Local archive file path
 * @param {string} params.s3Key - S3 key (path in bucket)
 * @param {S3Client} params.s3Client - S3 client instance
 * @returns {Promise<boolean>} - Success status
 */
const uploadArchiveToS3 = async ({ archivePath, s3Key, s3Client }) => {
  try {
    const fileContent = fs.readFileSync(archivePath);
    const fileSize = fs.statSync(archivePath).size;

    console.log(
      `📦 Uploading archive (${(fileSize / 1024 / 1024).toFixed(2)} MB) to S3...`,
    );

    const command = new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'application/gzip',
      Metadata: {
        'original-size': fileSize.toString(),
        mode: mode,
      },
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error(`❌ Failed to upload archive to S3:`, error.message);
    return false;
  }
};

/**
 * Sync entire log folder to S3 as a compressed archive
 * This function runs ALWAYS, regardless of LOG_TO_FILE setting
 * Even in console-only mode (LOG_TO_FILE=false), logs are backed up to S3
 * After successful sync, specific log files are automatically cleared
 * @returns {Promise<Object>} - Sync results
 */
export const syncLogsToS3 = async () => {
  const logPrefix = '[S3 Sync]';
  const s3Client = createS3Client();

  if (!s3Client) {
    console.warn(`${logPrefix} S3 sync skipped - credentials not configured`);
    return { success: false, reason: 'No credentials' };
  }

  // Always use console.log directly so messages appear regardless of LOG_TO_FILE setting
  console.log(`${logPrefix} Starting log sync to S3...`);

  const results = {
    success: false,
    archiveSize: 0,
    archiveSizeMB: 0,
    s3Location: '',
    errors: [],
  };

  try {
    const logDir = LOG_DIRECTORY_PATH_NAME;

    if (!fs.existsSync(logDir)) {
      console.warn(`${logPrefix} Log directory does not exist: ${logDir}`);
      return { success: false, reason: 'No log directory' };
    }

    // Create archive filename with timestamp
    const timestamp = getArchiveTimestamp();
    const dateFolder = formatDateForFolder(new Date());
    const archiveFileName = `logs-${mode}-${timestamp}.tar.gz`;
    const archivePath = path.join(path.dirname(logDir), archiveFileName);

    console.log(`${logPrefix} Creating archive of ${logDir}...`);

    // Create compressed archive of entire log directory
    const archiveCreated = await createLogArchive(logDir, archivePath);

    if (!archiveCreated) {
      results.errors.push('Failed to create archive');
      return results;
    }

    // Get archive size
    const stats = fs.statSync(archivePath);
    results.archiveSize = stats.size;
    results.archiveSizeMB = (stats.size / 1024 / 1024).toFixed(2);

    // Upload to S3 in date-based folder
    const s3Key = `${AWS_S3_PERMITTED_FOLDER}/${mode}/${dateFolder}/${archiveFileName}`;
    results.s3Location = `s3://${AWS_S3_BUCKET}/${s3Key}`;

    const uploaded = await uploadArchiveToS3({ archivePath, s3Key, s3Client });

    // Clean up local archive file
    try {
      fs.unlinkSync(archivePath);
    } catch (cleanupError) {
      console.warn(`${logPrefix} Failed to cleanup archive:`, cleanupError.message);
    }

    if (uploaded) {
      results.success = true;
      console.log(
        `${logPrefix} ✓ Archive uploaded successfully (${results.archiveSizeMB} MB)`,
      );
      console.log(`${logPrefix} S3 location: ${results.s3Location}`);

      // Clear log files after successful sync
      try {
        console.log(`${logPrefix} Clearing log files after successful sync...`);
        const clearStats = clearLogFiles(true);
        results.clearedFiles = clearStats;
      } catch (clearError) {
        console.error(`${logPrefix} Failed to clear logs: ${clearError.message}`);
        results.errors.push(`Clear logs failed: ${clearError.message}`);
      }

      // Log app version to system.log after clearing (so it persists in new log cycle)
      await logAppVersionToSystemLog({
        context: 'Sync completed successfully',
        logPrefix,
      });
    } else {
      results.success = false;
      results.errors.push('Failed to upload archive to S3');
    }
  } catch (error) {
    console.error(`${logPrefix} Sync failed:`, error);
    results.success = false;
    results.errors.push(error.message);
  }

  return results;
};

/**
 * List log archives in S3 for a specific date
 * @param {string} date - Date string in YYYY-MM-DD format
 * @returns {Promise<Array>} - List of archive objects with metadata
 */
export const listS3LogsForDate = async (date) => {
  const s3Client = createS3Client();

  if (!s3Client) {
    return [];
  }

  try {
    const prefix = `${AWS_S3_PERMITTED_FOLDER}/${mode}/${date}/`;

    const command = new ListObjectsV2Command({
      Bucket: AWS_S3_BUCKET,
      Prefix: prefix,
    });

    const response = await s3Client.send(command);

    return (response.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
      sizeInMB: (item.Size / 1024 / 1024).toFixed(2),
    }));
  } catch (error) {
    console.error(`Error listing S3 logs for date ${date}:`, error);
    return [];
  }
};

export default {
  syncLogsToS3,
  listS3LogsForDate,
};
