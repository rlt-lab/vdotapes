import type { DatabaseCore } from '../core/DatabaseCore';

export interface SettingsOperationsMonitor {
  wrapQuery<T>(name: string, fn: () => T): () => T;
}

export interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export class SettingsOperations {
  private core: DatabaseCore;
  private monitor: SettingsOperationsMonitor;

  constructor(core: DatabaseCore, monitor: SettingsOperationsMonitor) {
    this.core = core;
    this.monitor = monitor;
  }

  /**
   * Save setting with generic type support
   */
  saveSetting<T>(key: string, value: T): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('saveSetting', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        stmt.run(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error('Error saving setting:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get setting with generic type support and default value
   */
  getSetting<T>(key: string, defaultValue: T): T {
    if (!this.core.isInitialized()) {
      return defaultValue;
    }

    const monitoredQuery = this.monitor.wrapQuery('getSetting', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare(`
          SELECT value FROM settings WHERE key = ?
        `);

        const result = stmt.get(key) as { value: string } | undefined;

        if (result) {
          return JSON.parse(result.value);
        }

        return defaultValue;
      } catch (error) {
        console.error('Error getting setting:', error);
        return defaultValue;
      }
    });

    return monitoredQuery();
  }

  /**
   * Delete a setting
   */
  deleteSetting(key: string): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('deleteSetting', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
        stmt.run(key);
        return true;
      } catch (error) {
        console.error('Error deleting setting:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Get all settings as key-value pairs
   */
  getAllSettings(): Record<string, any> {
    if (!this.core.isInitialized()) {
      return {};
    }

    const monitoredQuery = this.monitor.wrapQuery('getAllSettings', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare('SELECT key, value FROM settings');
        const results = stmt.all() as Array<{ key: string; value: string }>;

        const settings: Record<string, any> = {};
        for (const { key, value } of results) {
          try {
            settings[key] = JSON.parse(value);
          } catch {
            settings[key] = value; // fallback for non-JSON values
          }
        }

        return settings;
      } catch (error) {
        console.error('Error getting all settings:', error);
        return {};
      }
    });

    return monitoredQuery();
  }

  // === SPECIFIC SETTING METHODS ===

  /**
   * Save last loaded folder
   */
  saveLastFolder(folderPath: string): boolean {
    return this.saveSetting('lastFolder', folderPath);
  }

  /**
   * Get last loaded folder
   */
  getLastFolder(): string | null {
    return this.getSetting('lastFolder', null);
  }

  /**
   * Save grid columns setting
   */
  saveGridColumns(columns: number): boolean {
    return this.saveSetting('gridColumns', columns);
  }

  /**
   * Get grid columns setting
   */
  getGridColumns(): number {
    return this.getSetting('gridColumns', 4);
  }

  /**
   * Save sort preference
   */
  saveSortPreference(sortBy: string, sortOrder = 'ASC'): boolean {
    return this.saveSetting('sortPreference', { sortBy, sortOrder });
  }

  /**
   * Get sort preference
   */
  getSortPreference(): { sortBy: string; sortOrder: string } {
    return this.getSetting('sortPreference', { sortBy: 'folder', sortOrder: 'ASC' });
  }

  /**
   * Save folder filter preference
   */
  saveFolderFilter(folder: string): boolean {
    return this.saveSetting('folderFilter', folder);
  }

  /**
   * Get folder filter preference
   */
  getFolderFilter(): string {
    return this.getSetting('folderFilter', '');
  }

  /**
   * Save favorites-only preference
   */
  saveFavoritesOnly(favoritesOnly: boolean): boolean {
    return this.saveSetting('favoritesOnly', favoritesOnly);
  }

  /**
   * Get favorites-only preference
   */
  getFavoritesOnly(): boolean {
    return this.getSetting('favoritesOnly', false);
  }

  /**
   * Save window size and position
   */
  saveWindowState(width: number, height: number, x: number, y: number): boolean {
    return this.saveSetting('windowState', { width, height, x, y });
  }

  /**
   * Get window size and position
   */
  getWindowState(): WindowState {
    return this.getSetting('windowState', { width: 1400, height: 900, x: null, y: null });
  }

  /**
   * Save UI theme preference
   */
  saveTheme(theme: 'light' | 'dark' | 'system'): boolean {
    return this.saveSetting('theme', theme);
  }

  /**
   * Get UI theme preference
   */
  getTheme(): 'light' | 'dark' | 'system' {
    return this.getSetting('theme', 'system');
  }

  /**
   * Save auto-scan preference
   */
  saveAutoScan(autoScan: boolean): boolean {
    return this.saveSetting('autoScan', autoScan);
  }

  /**
   * Get auto-scan preference
   */
  getAutoScan(): boolean {
    return this.getSetting('autoScan', true);
  }

  /**
   * Save show hidden files preference
   */
  saveShowHiddenFiles(showHidden: boolean): boolean {
    return this.saveSetting('showHiddenFiles', showHidden);
  }

  /**
   * Get show hidden files preference
   */
  getShowHiddenFiles(): boolean {
    return this.getSetting('showHiddenFiles', false);
  }

  /**
   * Save video preview settings
   */
  saveVideoPreviewSettings(settings: {
    autoPlay: boolean;
    volume: number;
    showControls: boolean;
  }): boolean {
    return this.saveSetting('videoPreview', settings);
  }

  /**
   * Get video preview settings
   */
  getVideoPreviewSettings(): {
    autoPlay: boolean;
    volume: number;
    showControls: boolean;
  } {
    return this.getSetting('videoPreview', {
      autoPlay: true,
      volume: 0.5,
      showControls: true,
    });
  }

  /**
   * Save thumbnail generation settings
   */
  saveThumbnailSettings(settings: {
    generateThumbnails: boolean;
    thumbnailSize: number;
    thumbnailQuality: number;
  }): boolean {
    return this.saveSetting('thumbnailSettings', settings);
  }

  /**
   * Get thumbnail generation settings
   */
  getThumbnailSettings(): {
    generateThumbnails: boolean;
    thumbnailSize: number;
    thumbnailQuality: number;
  } {
    return this.getSetting('thumbnailSettings', {
      generateThumbnails: false,
      thumbnailSize: 200,
      thumbnailQuality: 80,
    });
  }

  /**
   * Reset all settings to defaults
   */
  resetAllSettings(): boolean {
    if (!this.core.isInitialized()) {
      return false;
    }

    const monitoredQuery = this.monitor.wrapQuery('resetAllSettings', () => {
      try {
        const db = this.core.getConnection();
        // Don't reset schema_version
        const stmt = db.prepare('DELETE FROM settings WHERE key != ?');
        stmt.run('schema_version');
        return true;
      } catch (error) {
        console.error('Error resetting settings:', error);
        return false;
      }
    });

    return monitoredQuery();
  }

  /**
   * Export all settings for backup
   */
  exportSettings(): Array<{ key: string; value: any; updatedAt: string }> {
    if (!this.core.isInitialized()) {
      return [];
    }

    const monitoredQuery = this.monitor.wrapQuery('exportSettings', () => {
      try {
        const db = this.core.getConnection();
        const stmt = db.prepare('SELECT key, value, updated_at FROM settings WHERE key != ?');
        const results = stmt.all('schema_version') as Array<{
          key: string;
          value: string;
          updated_at: string;
        }>;

        return results.map(({ key, value, updated_at }) => {
          try {
            return {
              key,
              value: JSON.parse(value),
              updatedAt: updated_at,
            };
          } catch {
            return {
              key,
              value,
              updatedAt: updated_at,
            };
          }
        });
      } catch (error) {
        console.error('Error exporting settings:', error);
        return [];
      }
    });

    return monitoredQuery();
  }

  /**
   * Import settings from backup
   */
  importSettings(settings: Array<{ key: string; value: any }>): {
    imported: number;
    errors: number;
  } {
    if (!this.core.isInitialized()) {
      return { imported: 0, errors: settings.length };
    }

    let imported = 0;
    let errors = 0;

    for (const { key, value } of settings) {
      // Skip schema_version during import
      if (key === 'schema_version') continue;

      try {
        if (this.saveSetting(key, value)) {
          imported++;
        } else {
          errors++;
        }
      } catch (error) {
        console.error(`Error importing setting ${key}:`, error);
        errors++;
      }
    }

    return { imported, errors };
  }
}