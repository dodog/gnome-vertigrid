import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';

import {
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {
    SIDE_CONTROLS_ANIMATION_TIME
} from 'resource:///org/gnome/shell/ui/overviewControls.js';

import {
    CATEGORY_ORDER,
    getAppCategory,
    setAppCategory,
    getCategoryOrderMap
} from './categories.js';

const CATEGORY_ICONS = {
    _favorites: 'starred-symbolic',
    Other: 'applications-other-symbolic',
    Development: 'utilities-terminal-symbolic',
    Office: 'x-office-document-symbolic',
    Network: 'network-wired-symbolic',
    AudioVideo: 'multimedia-symbolic',
    Audio: 'audio-x-generic-symbolic',
    Video: 'video-x-generic-symbolic',
    Graphics: 'graphics-symbolic',
    Translation: 'emblem-translate-symbolic',
    WebDevelopment: 'internet-web-browser-symbolic',
    PackageManager: 'package-x-generic-symbolic',
    Ebook: 'accessories-text-editor-symbolic',
    HardwareSettings: 'computer-symbolic',
    Finance: 'wallet-symbolic',
    Backup: 'document-save-symbolic',
    Security: 'security-high-symbolic',
    Chat: 'mail-message-new-symbolic',
    Fonts: 'font-panel-symbolic',
    Education: 'accessories-calculator-symbolic',
    Game: 'gamepad-symbolic',
    Utility: 'applications-utilities-symbolic',
    Accessories: 'applications-accessories-symbolic',
    System: 'computer-symbolic',
    Settings: 'emblem-system-symbolic'
};

function easeOutCubic(t) {
    return (--t) * t * t + 1;
}

export const VerticalAppDisplay = GObject.registerClass(
    class VerticalAppDisplay extends St.Widget {
        _init(settings) {
            this._settings = settings;
            this._laters = global.compositor.get_laters();

            super._init({
                layout_manager: new Clutter.BinLayout(),
                can_focus: true,
                reactive: true
            });

            this._favoritesLabel = new St.Label({
                text: _('Favorites'),
                style: 'font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);'
            });

            this._favoritesView = new St.Viewport({
                layout_manager: new VerticalLayout(settings),
                style: 'overflow: hidden;'
            });

            this._mainLabel = new St.Label({
                text: _('All Apps'),
                style: 'font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);'
            });

            this._mainView = new St.Viewport({
                layout_manager: new VerticalLayout(settings),
                style: 'overflow: hidden;'
            });

            this._scrollView = new VerticalScrollView(settings);

            this._scrollView.add_child(this._favoritesLabel);
            this._scrollView.add_child(this._favoritesView);
            this._scrollView.add_child(this._mainLabel);
            this._scrollView.add_child(this._mainView);

            this._navBox = new St.BoxLayout({
                vertical: true,
                x_expand: false,
                y_expand: true,
                style_class: 'category-nav-box',
                style: 'margin-right: 8px; padding: 8px 0 8px 8px; width: 220px;'
            });

            this._mainBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                y_expand: true
            });

            this._mainBox.add_child(this._navBox);
            this._mainBox.add_child(this._scrollView);
            this.add_child(this._mainBox);

            this._navItems = [];
            this._navButtons = {};
            this._navSeparators = [];

            this._appSystem = Shell.AppSystem.get_default();
            this._appUsage = Shell.AppUsage.get_default();
            this._appFavorites = AppFavorites.getAppFavorites();
            this._parentalControls = ParentalControlsManager.getDefault();
            this._overview = Main.overview;

            this._connectSignals();
            this._addAppIcons();
            this._updateLabelMargins();
        }

        _connectSignals() {
            // Redisplay the app grid when an app was installed or removed
            this._appSystem.connectObject('installed-changed', () => {
                this._redisplay();
            }, this);

            // Redisplay when favorites change
            this._appFavorites.connectObject('changed', () => {
                this._redisplay();
            }, this);

            // Redisplay when parental controls change
            this._parentalControls.connectObject('app-filter-changed', () => {
                this._redisplay();
            }, this);

            // Reset scroll when the overview is hidden
            this._overview.connectObject('hidden', () => {
                this._scrollView.scrollTo(0, false);
            }, this);

            // Update layout when settings change
            this._settings.connectObject('changed', (_, key) => {
                switch (key) {
                    case 'app-sorting':
                    case 'favorites-section':
                    case 'favorites-sorting':
                    case 'category-grouping':
                    case 'show-favorites-in-app-grid':
                    case 'category-font-size':
                        return this._redisplay();

                    case 'icon-spacing':
                        return this._updateLabelMargins();

                    case 'icon-size':
                        return this._updateIconSize();
                }
            }, this);
        }

        _addAppIcons() {
            const iconSize = this._settings.get_int('icon-size');
            const favSection = this._settings.get_boolean('favorites-section');
            const categoryGrouping = this._settings.get_boolean('category-grouping');

            this._appIcons = [];
            this._categoryLabels = {};
            this._categoryViews = {};

            if (categoryGrouping) {
                // Category grouping mode - hide original mainLabel/mainView
                this._mainLabel.hide();
                this._mainView.hide();
                this._favoritesLabel.hide();
                this._favoritesView.hide();

                const appsByCategory = this._loadAppsByCategory();

                // First, add favorites section if enabled
                if (favSection && appsByCategory._favorites.length > 0) {
                    const favLabel = new St.Label({
                        text: _('Favorites'),
                        style: 'font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);'
                    });
                    const favView = new St.Viewport({
                        layout_manager: new VerticalLayout(this._settings),
                        style: 'overflow: hidden;'
                    });

                    this._categoryLabels['_favorites'] = favLabel;
                    this._categoryViews['_favorites'] = favView;

                    // Insert at the beginning to ensure favorites is always on top
                    this._scrollView.get_child().insert_child_at_index(favLabel, 0);
                    this._scrollView.get_child().insert_child_at_index(favView, 1);

                    for (const appId of appsByCategory._favorites) {
                        const app = this._appSystem.lookup_app(appId);
                        if (!app) continue;
                        const appIcon = new AppDisplay.AppIcon(app, {
                            isDraggable: false
                        });
                        try {
                            appIcon._appId = app.get_id();
                        } catch (e) {}
                        this._attachDragHandlers(appIcon);
                        appIcon.icon.setIconSize(iconSize);
                        favView.add_child(appIcon);
                        this._appIcons.push(appIcon);
                    }
                }

                // Then add category sections
                for (const category of CATEGORY_ORDER) {
                    const appIds = appsByCategory[category] || [];

                    const label = new St.Label({
                        text: _(category),
                        style: 'font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);'
                    });
                    const view = new St.Viewport({
                        layout_manager: new VerticalLayout(this._settings),
                        style: 'overflow: hidden;'
                    });

                    this._categoryLabels[category] = label;
                    this._categoryViews[category] = view;

                    this._scrollView.add_child(label);
                    this._scrollView.add_child(view);

                    // Add any apps for this category (if present)
                    for (const appId of appIds) {
                        const app = this._appSystem.lookup_app(appId);
                        if (!app) continue;
                        const appIcon = new AppDisplay.AppIcon(app, {
                            isDraggable: false
                        });
                        try {
                            appIcon._appId = app.get_id();
                        } catch (e) {}
                        // Attach centralized drag handlers
                        this._attachDragHandlers(appIcon);
                        appIcon.icon.setIconSize(iconSize);
                        view.add_child(appIcon);
                        this._appIcons.push(appIcon);
                    }
                }

                // Add Other category if it has apps
                if (appsByCategory['Other'] && appsByCategory['Other'].length > 0) {
                    const label = new St.Label({
                        text: _('Other'),
                        style: 'font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);'
                    });
                    const view = new St.Viewport({
                        layout_manager: new VerticalLayout(this._settings),
                        style: 'overflow: hidden;'
                    });

                    this._categoryLabels['Other'] = label;
                    this._categoryViews['Other'] = view;

                    this._scrollView.add_child(label);
                    this._scrollView.add_child(view);

                    for (const appId of appsByCategory['Other']) {
                        const app = this._appSystem.lookup_app(appId);
                        if (!app) continue;
                        const appIcon = new AppDisplay.AppIcon(app, {
                            isDraggable: false
                        });
                        try {
                            appIcon._appId = app.get_id();
                        } catch (e) {}
                        this._attachDragHandlers(appIcon);
                        appIcon.icon.setIconSize(iconSize);
                        view.add_child(appIcon);
                        this._appIcons.push(appIcon);
                    }
                }

                this._buildCategoryNav(appsByCategory);
                this._navBox.show();
            } else {
                this._navBox.hide();
                // Original mode: Favorites and All Apps
                // Show original labels and views
                this._favoritesLabel.show();
                this._favoritesView.show();
                this._mainLabel.show();
                this._mainView.show();

                // Ensure favorites is at the top by reordering
                const scrollBox = this._scrollView.get_child();
                const favLabelIndex = scrollBox.get_children().indexOf(this._favoritesLabel);
                const favViewIndex = scrollBox.get_children().indexOf(this._favoritesView);

                if (favLabelIndex !== 0) {
                    scrollBox.set_child_at_index(this._favoritesLabel, 0);
                    scrollBox.set_child_at_index(this._favoritesView, 1);
                }

                const syncFavorites = this._settings.get_boolean('show-favorites-in-app-grid');
                const installedApps = this._appSystem.get_installed();
                const favSorting = this._settings.get_string('favorites-sorting');
                const appSorting = this._settings.get_string('app-sorting');
                const favIds = this._appFavorites._getIds();

                const favAppInfos = [];
                const mainAppInfos = [];

                installedApps.forEach(appInfo => {
                    try {
                        if (!this._parentalControls.shouldShowApp(appInfo))
                            return;

                        const appId = appInfo.get_id();
                        const isFav = this._appFavorites.isFavorite(appId);

                        if (favSection && isFav) {
                            favAppInfos.push(appInfo);
                            if (!syncFavorites) return;
                        }

                        mainAppInfos.push(appInfo);
                    } catch {}
                });

                // Sort favorites
                favAppInfos.sort((a, b) => {
                    switch (favSorting) {
                        case 'dash':
                            return favIds.indexOf(a.get_id()) - favIds.indexOf(b.get_id());
                        case 'usage':
                            return this._appUsage.compare(a.get_id(), b.get_id()) || 0;
                        case 'alphabetical':
                        default:
                            return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
                    }
                });

                // Sort main apps
                mainAppInfos.sort((a, b) => {
                    switch (appSorting) {
                        case 'usage':
                            return this._appUsage.compare(a.get_id(), b.get_id()) || 0;
                        case 'alphabetical':
                        default:
                            return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
                    }
                });

                // Add favorites
                for (const appInfo of favAppInfos) {
                    const app = this._appSystem.lookup_app(appInfo.get_id());
                    if (!app) continue;
                    const appIcon = new AppDisplay.AppIcon(app, {
                        isDraggable: false
                    });
                    appIcon.icon.setIconSize(iconSize);
                    try {
                        appIcon._appId = app.get_id();
                    } catch (e) {}
                    this._attachDragHandlers(appIcon);
                    this._favoritesView.add_child(appIcon);
                    this._appIcons.push(appIcon);
                }

                // Add main apps
                for (const appInfo of mainAppInfos) {
                    const app = this._appSystem.lookup_app(appInfo.get_id());
                    if (!app) continue;
                    const appIcon = new AppDisplay.AppIcon(app, {
                        isDraggable: false
                    });
                    appIcon.icon.setIconSize(iconSize);
                    try {
                        appIcon._appId = app.get_id();
                    } catch (e) {}
                    this._attachDragHandlers(appIcon);
                    this._mainView.add_child(appIcon);
                    this._appIcons.push(appIcon);
                }

                const showFavSection = this._favoritesView.get_children().length > 0;
                const showMainSection = this._mainView.get_children().length > 0;
                const showMainLabel = showFavSection && showMainSection;

                this._favoritesLabel.visible = showFavSection;
                this._favoritesView.visible = showFavSection;
                this._mainLabel.visible = showMainLabel;
                this._mainView.visible = showMainSection;
            }
        }

        _buildCategoryNav(appsByCategory) {
            this._destroyCategoryNav();

            const visibleCategories = [];

            if (appsByCategory['_favorites'] && appsByCategory['_favorites'].length > 0) {
                visibleCategories.push({
                    id: '_favorites',
                    label: _('Favorites')
                });
            }

            for (const category of CATEGORY_ORDER) {
                visibleCategories.push({
                    id: category,
                    label: _(category)
                });
            }

            if (appsByCategory['Other'] && appsByCategory['Other'].length > 0) {
                visibleCategories.push({
                    id: 'Other',
                    label: _('Other')
                });
            }

            const fontSize = this._settings.get_int('category-font-size');

            visibleCategories.forEach((item, index) => {
                // Insert a thin horizontal separator between each category,
                // but not before the very first one.
                if (index > 0) {
                    const separator = new St.Widget({
                        x_expand: true,
                        style: 'height: 1px; margin: 4px 8px; background-color: rgba(255,255,255,0.12);'
                    });
                    this._navBox.add_child(separator);
                    this._navSeparators.push(separator);
                }

                const button = new St.Button({
                    x_expand: true,
                    reactive: true,
                    can_focus: true,
                    y_expand: false,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: this._getCategoryButtonStyle(false)
                });
                button._categoryId = item.id;

                const categoryRow = new St.BoxLayout({
                    vertical: false,
                    x_expand: true,
                    y_expand: false,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'align-items: center;'
                });

                const icon = new St.Icon({
                    icon_name: CATEGORY_ICONS[item.id] || 'applications-other-symbolic',
                    icon_size: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'margin-right: 10px; opacity: 0.75;'
                });
                const label = new St.Label({
                    text: item.label,
                    style_class: 'search-statustext',
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `font-weight: 500; font-size: ${Math.max(fontSize - 2, 11)}px; margin: 0; color: rgba(255,255,255,0.96);`
                });

                categoryRow.add_child(icon);
                categoryRow.add_child(label);
                button.add_child(categoryRow);

                button.connect('clicked', () => {
                    this._scrollToCategory(item.id);
                });

                this._navBox.add_child(button);
                this._navItems.push(button);
                this._navButtons[item.id] = button;
            });

            if (this._navItems.length > 0 && !this._activeCategory) {
                this._setActiveCategory(this._navItems[0]._categoryId);
            }

            this._navBox.visible = this._navItems.length > 0;
        }

        _destroyCategoryNav() {
            this._navItems.forEach(button => button.destroy());
            this._navItems = [];
            this._navButtons = {};

            this._navSeparators.forEach(sep => sep.destroy());
            this._navSeparators = [];

            this._activeCategory = null;
        }

        _getCategoryButtonStyle(isActive) {
            const base = 'margin: 2px 0; padding: 6px 8px 4px 8px; border-radius: 12px; text-align: left; width: 100%; border: none;';
            const active = 'background-color: rgba(255,255,255,0.16); color: white; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);';
            const normal = 'background-color: transparent; color: rgba(255,255,255,0.92);';
            return base + (isActive ? active : normal);
        }

        _setActiveCategory(category) {
            this._activeCategory = category;
            this._navItems.forEach(button => {
                const isActive = button._categoryId === category;
                button.set_style(this._getCategoryButtonStyle(isActive));
            });
        }

        _scrollToCategory(category) {
            const target = this._categoryLabels[category];
            if (!target) {
                return;
            }

            this._scrollView.scrollToChild(target);
            this._setActiveCategory(category);
        }

        _loadAppsByCategory() {
            const installedApps = this._appSystem.get_installed();
            const favSection = this._settings.get_boolean('favorites-section');
            const syncFavorites = this._settings.get_boolean('show-favorites-in-app-grid');

            const appsByCategory = {};
            for (const cat of CATEGORY_ORDER) {
                appsByCategory[cat] = [];
            }
            appsByCategory['Other'] = [];
            appsByCategory['_favorites'] = [];

            installedApps.forEach(appInfo => {
                try {
                    const appId = appInfo.get_id();

                    if (!this._parentalControls.shouldShowApp(appInfo))
                        return;

                    const isFav = this._appFavorites.isFavorite(appId);

                    // Add to favorites section if enabled
                    if (favSection && isFav) {
                        appsByCategory['_favorites'].push(appInfo);
                        // If show-favorites-in-app-grid is enabled, also add to category (don't return)
                        if (!syncFavorites) return;
                    }

                    const category = getAppCategory(appInfo);
                    appsByCategory[category].push(appInfo);
                } catch {}
            });

            // Sort apps within each category
            const appSorting = this._settings.get_string('app-sorting');

            for (const category in appsByCategory) {
                if (category === '_favorites') continue;

                appsByCategory[category].sort((a, b) => {
                    switch (appSorting) {
                        case 'usage':
                            return this._appUsage.compare(a.get_id(), b.get_id()) || 0;
                        case 'alphabetical':
                        default:
                            return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
                    }
                });

                appsByCategory[category] = appsByCategory[category].map(appInfo => appInfo.get_id());
            }

            // Apply user-defined ordering (from app-category-overrides with index)
            try {
                const orderMap = getCategoryOrderMap();
                for (const [cat, order] of orderMap.entries()) {
                    if (!appsByCategory[cat]) continue;
                    const present = new Set(appsByCategory[cat]);
                    const ordered = [];
                    for (const id of order) {
                        if (present.has(id)) {
                            ordered.push(id);
                            present.delete(id);
                        }
                    }
                    // append remaining apps
                    for (const id of appsByCategory[cat])
                        if (present.has(id)) ordered.push(id);
                    appsByCategory[cat] = ordered;
                }
            } catch (e) {}

            // Sort favorites
            if (appsByCategory['_favorites'].length > 0) {
                const favSorting = this._settings.get_string('favorites-sorting');
                const favIds = this._appFavorites._getIds();

                appsByCategory['_favorites'].sort((a, b) => {
                    switch (favSorting) {
                        case 'dash':
                            return favIds.indexOf(a.get_id()) - favIds.indexOf(b.get_id());
                        case 'usage':
                            return this._appUsage.compare(a.get_id(), b.get_id()) || 0;
                        case 'alphabetical':
                        default:
                            return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
                    }
                });

                appsByCategory['_favorites'] = appsByCategory['_favorites'].map(appInfo => appInfo.get_id());
            }

            return appsByCategory;
        }

        _loadApps() {
            const installedApps = this._appSystem.get_installed();

            const favs = [];
            const apps = [];

            // Filter out hidden apps and split off favorites
            const favSection = this._settings.get_boolean('favorites-section');

            installedApps.forEach(appInfo => {
                try {
                    const appId = appInfo.get_id();
                    const isFav = this._appFavorites.isFavorite(appId);

                    if (this._parentalControls.shouldShowApp(appInfo)) {
                        if (favSection && isFav) {
                            favs.push(appInfo);
                        } else {
                            apps.push(appInfo);
                        }
                    }
                } catch {}
            });

            // Sort favorites
            const favSorting = this._settings.get_string('favorites-sorting');
            const favIds = this._appFavorites._getIds();

            favs.sort((a, b) => {
                switch (favSorting) {
                    case 'dash':
                        return favIds.indexOf(a.get_id()) - favIds.indexOf(b.get_id());

                    case 'usage':
                        return this._appUsage.compare(a.get_id(), b.get_id()) || 0;

                    case 'alphabetical':
                    default:
                        return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
                }
            });

            // Sort apps
            const appSorting = this._settings.get_string('app-sorting');

            apps.sort((a, b) => {
                switch (appSorting) {
                    case 'usage':
                        return this._appUsage.compare(a.get_id(), b.get_id()) || 0;

                    case 'alphabetical':
                    default:
                        return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
                }
            });

            return [...favs, ...apps].map(appInfo => appInfo.get_id());
        }

        _redisplay() {
            this._animateRedisplay(() => {
                this._redisplayLater = this._laters.add(Meta.LaterType.IDLE, () => {
                    this._favoritesView.destroy_all_children();
                    this._mainView.destroy_all_children();

                    // Clean up category views if they exist
                    for (const category in this._categoryLabels) {
                        if (this._categoryLabels[category]) {
                            this._categoryLabels[category].destroy();
                            this._categoryLabels[category] = null;
                        }
                    }
                    for (const category in this._categoryViews) {
                        if (this._categoryViews[category]) {
                            this._categoryViews[category].destroy();
                            this._categoryViews[category] = null;
                        }
                    }
                    this._categoryLabels = {};
                    this._categoryViews = {};

                    this._addAppIcons();
                    this._animateRedisplay();
                });
            });
        }

        _animateRedisplay(onComplete) {
            this._scrollView.ease({
                onComplete,
                opacity: onComplete ? 0 : 255,
                duration: SIDE_CONTROLS_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        }

        _updateLabelMargins() {
            const spacing = this._settings.get_int('icon-spacing');

            // Original favorites label (non-category mode)
            if (this._favoritesLabel && this._favoritesLabel.visible) {
                this._favoritesLabel.set_style(`margin: 0 0 ${spacing}px 0; font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);`);
            }
            // Original main label (non-category mode)
            if (this._mainLabel && this._mainLabel.visible) {
                this._mainLabel.set_style(`margin: ${spacing * 2}px 0 ${spacing}px 0; font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);`);
            }

            // Category labels (including _favorites in category mode)
            for (const category in this._categoryLabels) {
                if (this._categoryLabels[category] && this._categoryLabels[category].visible) {
                    if (category === '_favorites') {
                        this._categoryLabels[category].set_style(`margin: 0 0 ${spacing}px 0; font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);`);
                    } else {
                        this._categoryLabels[category].set_style(`margin: ${spacing * 2}px 0 ${spacing}px 0; font-size: 16px; font-weight: 400; color: white; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.3);`);
                    }
                }
            }
        }

        _updateIconSize() {
            const size = this._settings.get_int('icon-size');

            this._appIcons.forEach(appIcon => {
                appIcon.icon.setIconSize(size);
            });
        }

        _getEventCoords(event) {
            try {
                if (event && event.get_coords) {
                    const coords = event.get_coords();
                    return [Math.floor(coords[0]), Math.floor(coords[1])];
                }

                const p = global.get_pointer();
                if (p && p.length >= 2) {
                    // Some environments return [device, x, y]
                    if (p.length >= 3) return [Math.floor(p[1]), Math.floor(p[2])];
                    return [Math.floor(p[0]), Math.floor(p[1])];
                }
            } catch (e) {}

            return [0, 0];
        }

        _findCategoryViewFromActor(actor) {
            let target = actor;
            while (target) {
                for (const cat in this._categoryViews) {
                    if (this._categoryViews[cat] === target) {
                        return {
                            view: this._categoryViews[cat],
                            category: cat
                        };
                    }
                }
                try {
                    target = target.get_parent();
                } catch (e) {
                    target = null;
                }
            }
            return {
                view: null,
                category: null
            };
        }

        _findCategoryViewAtStagePoint(x, y) {
            for (const cat in this._categoryViews) {
                const view = this._categoryViews[cat];
                if (!view) continue;

                let viewPos = [0, 0];
                try {
                    if (view.translate_coordinates) {
                        viewPos = view.translate_coordinates(global.stage, 0, 0);
                    } else if (view.get_transformed_position) {
                        viewPos = view.get_transformed_position();
                    }
                } catch (e) {}

                let bounds = null;
                try {
                    bounds = view.get_allocation_box();
                } catch (e) {}

                // If the view has no allocation (empty), try to allow dropping
                // on the area under the category label so users can drop into
                // empty categories.
                let width = 0;
                let height = 0;
                if (bounds) {
                    width = bounds.x2 - bounds.x1;
                    height = bounds.y2 - bounds.y1;
                }

                // Primary hit-test: view bounds
                if (bounds && x >= viewPos[0] && x <= viewPos[0] + width && y >= viewPos[1] && y <= viewPos[1] + height) {
                    return {
                        view,
                        category: cat
                    };
                }

                // If view is effectively empty (very small height), expand drop area
                // to include the label and a small region below it so dragging
                // into empty categories works.
                try {
                    if (!bounds || height <= 2) {
                        const label = this._categoryLabels[cat];
                        if (label) {
                            let labelPos = [0, 0];
                            try {
                                if (label.translate_coordinates) {
                                    labelPos = label.translate_coordinates(global.stage, 0, 0);
                                } else if (label.get_transformed_position) {
                                    labelPos = label.get_transformed_position();
                                }
                            } catch (e) {}

                            let labelBox = null;
                            try {
                                labelBox = label.get_allocation_box();
                            } catch (e) {}

                            const labelWidth = labelBox ? (labelBox.x2 - labelBox.x1) : Math.max(64, width);
                            const labelHeight = labelBox ? (labelBox.y2 - labelBox.y1) : 24;

                            const dropPadding = 160; // extra vertical area below label

                            const dropX1 = labelPos[0];
                            const dropX2 = labelPos[0] + labelWidth;
                            const dropY1 = labelPos[1];
                            const dropY2 = labelPos[1] + labelHeight + dropPadding;

                            if (x >= dropX1 && x <= dropX2 && y >= dropY1 && y <= dropY2) {
                                return {
                                    view,
                                    category: cat
                                };
                            }
                        }
                    }
                } catch (e) {}
            }
            return {
                view: null,
                category: null
            };
        }

        _startDrag(actor) {
            try {
                // Ensure any previous drag state is cleared
                if (this._dragGhost) {
                    try {
                        global.stage.remove_child(this._dragGhost);
                    } catch (e) {}
                    this._dragGhost = null;
                }

                this._dragActor = actor;
                actor._dragging = true;

                // Create drag ghost
                try {
                    this._dragGhost = new Clutter.Clone({
                        source: actor
                    });
                    this._dragGhost.set_opacity(200);
                    this._dragGhost.set_scale(0.9, 0.9);
                    try {
                        this._dragGhost.set_reactive(false);
                    } catch (e) {}
                    global.stage.add_child(this._dragGhost);
                    this._dragGhost.raise_top();
                } catch (e) {}

                // Connect motion handler
                if (this._dragMotionHandler) {
                    try {
                        global.stage.disconnect(this._dragMotionHandler);
                    } catch (e) {}
                    this._dragMotionHandler = null;
                }

                this._dragMotionHandler = global.stage.connect('motion-event', (stage, motionEvent) => {
                    try {
                        const [mx, my] = this._getEventCoords(motionEvent);
                        if (this._dragGhost) {
                            const [w, h] = [this._dragGhost.get_width(), this._dragGhost.get_height()];
                            this._dragGhost.set_position(Math.floor(mx - w / 2), Math.floor(my - h / 2));
                        }

                        const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, mx, my);
                        let found = this._findCategoryViewFromActor(target);
                        if (!found.view) {
                            found = this._findCategoryViewAtStagePoint(mx, my);
                        }
                        const foundView = found.view;
                        if (foundView !== this._highlightedView) {
                            try {
                                if (this._highlightedView) this._highlightedView.set_style('');
                            } catch (e) {}
                            this._highlightedView = foundView;
                            try {
                                if (this._highlightedView) this._highlightedView.set_style('box-shadow: inset 0 0 0 2px rgba(255,255,255,0.08); background-color: rgba(255,255,255,0.02);');
                            } catch (e) {}
                        }
                    } catch (e) {}
                    return Clutter.EVENT_PROPAGATE;
                });

                // Connect stage release handler
                if (this._dragStageHandler) {
                    try {
                        global.stage.disconnect(this._dragStageHandler);
                    } catch (e) {}
                    this._dragStageHandler = null;
                }

                this._dragStageHandler = global.stage.connect('button-release-event', (stage, releaseEvent) => {
                    try {
                        if (!this._dragActor) return Clutter.EVENT_PROPAGATE;
                        const src = this._dragActor;
                        src._dragging = false;
                        const [rx, ry] = this._getEventCoords(releaseEvent);

                        const dumpActorPath = actor => {
                            const path = [];
                            let current = actor;
                            while (current) {
                                const name = current.get_name ? current.get_name() : '<unnamed>';
                                const type = current.toString ? current.toString() : '<unknown>';
                                path.push(`${name} (${type})`);
                                try {
                                    current = current.get_parent();
                                } catch (e) {
                                    current = null;
                                }
                            }
                            return path.join(' -> ');
                        };

                        log(`vertigrid: drop release coords=${rx},${ry}`);
                        const targetActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, rx, ry);
                        log(`vertigrid: hit targetActor=${targetActor ? targetActor.get_name ? targetActor.get_name() : '<unknown>' : 'null'}`);
                        log(`vertigrid: actor hierarchy=${targetActor ? dumpActorPath(targetActor) : '<none>'}`);

                        let found = this._findCategoryViewFromActor(targetActor);
                        if (!found.view) {
                            found = this._findCategoryViewAtStagePoint(rx, ry);
                            log(`vertigrid: fallback category=${found.category}`);
                        }
                        log(`vertigrid: found category=${found.category}`);
                        if (found.view) {
                            const cat = found.category;
                            const destView = found.view;

                            let childUnder = targetActor;
                            let insertIndex = destView.get_children().length;

                            while (childUnder && childUnder !== destView) {
                                if (childUnder.get_parent && childUnder.get_parent() === destView) {
                                    const children = destView.get_children();
                                    const idx = children.indexOf(childUnder);
                                    if (idx !== -1) {
                                        insertIndex = idx;
                                        break;
                                    }
                                }
                                try {
                                    childUnder = childUnder.get_parent();
                                } catch (e) {
                                    childUnder = null;
                                }
                            }

                            log(`vertigrid: dropping into=${cat} insertIndex=${insertIndex}`);
                            try {
                                setAppCategory(src._appId, cat, insertIndex);
                            } catch (e) {
                                log(`vertigrid: setAppCategory error=${e}`);
                                setAppCategory(src._appId, cat);
                            }

                            this._redisplay();
                        }
                    } catch (e) {
                        log(`vertigrid: release handler exception=${e}`);
                    }
                    try {
                        global.stage.disconnect(this._dragStageHandler);
                    } catch (e) {}
                    this._dragStageHandler = null;

                    if (this._dragMotionHandler) {
                        try {
                            global.stage.disconnect(this._dragMotionHandler);
                        } catch (e) {}
                        this._dragMotionHandler = null;
                    }

                    if (this._dragGhost) {
                        try {
                            global.stage.remove_child(this._dragGhost);
                        } catch (e) {}
                        this._dragGhost = null;
                    }

                    this._dragActor = null;
                    return Clutter.EVENT_STOP;
                });
            } catch (e) {}
        }

        _attachDragHandlers(appIcon) {
            appIcon.reactive = true;
            appIcon.connect('button-press-event', (actor, event) => {
                try {
                    const [x, y] = this._getEventCoords(event);
                    actor._dragStart = {
                        x,
                        y
                    };

                    // Small threshold before starting an actual drag (px)
                    const threshold = 8;

                    // Clean any pending handlers
                    if (this._pendingMotionId) {
                        try {
                            global.stage.disconnect(this._pendingMotionId);
                        } catch (e) {}
                        this._pendingMotionId = null;
                    }
                    if (this._pendingReleaseId) {
                        try {
                            global.stage.disconnect(this._pendingReleaseId);
                        } catch (e) {}
                        this._pendingReleaseId = null;
                    }

                    // Pending motion handler: wait until pointer moves beyond threshold
                    this._pendingMotionId = global.stage.connect('motion-event', (stage, motionEvent) => {
                        try {
                            const [mx, my] = this._getEventCoords(motionEvent);
                            const dx = mx - actor._dragStart.x;
                            const dy = my - actor._dragStart.y;
                            const distSq = dx * dx + dy * dy;
                            if (distSq >= threshold * threshold) {
                                // start actual drag
                                try {
                                    global.stage.disconnect(this._pendingMotionId);
                                } catch (e) {}
                                this._pendingMotionId = null;
                                try {
                                    global.stage.disconnect(this._pendingReleaseId);
                                } catch (e) {}
                                this._pendingReleaseId = null;
                                this._startDrag(actor);
                            }
                        } catch (e) {}
                        return Clutter.EVENT_PROPAGATE;
                    });

                    // If released before threshold, cancel pending drag
                    this._pendingReleaseId = global.stage.connect('button-release-event', (stage, relEvent) => {
                        try {
                            if (this._pendingMotionId) {
                                try {
                                    global.stage.disconnect(this._pendingMotionId);
                                } catch (e) {}
                                this._pendingMotionId = null;
                            }
                            if (this._pendingReleaseId) {
                                try {
                                    global.stage.disconnect(this._pendingReleaseId);
                                } catch (e) {}
                                this._pendingReleaseId = null;
                            }
                        } catch (e) {}
                        return Clutter.EVENT_PROPAGATE;
                    });
                } catch (e) {}
                return Clutter.EVENT_PROPAGATE;
            });
        }

        vfunc_key_press_event(event) {
            const key = event.get_key_symbol();
            const focused = global.stage.get_key_focus();

            if (key === Clutter.KEY_Escape) {
                return Clutter.EVENT_PROPAGATE;
            }

            // Keyboard scroll
            const adjustment = this._scrollView.vadjustment;
            const pageSize = adjustment.page_size;

            const scroll = {
                [Clutter.KEY_Home]: 0,
                [Clutter.KEY_End]: adjustment.upper - pageSize,
                [Clutter.KEY_Page_Up]: this._scrollView.scroll - pageSize * 0.8,
                [Clutter.KEY_Page_Down]: this._scrollView.scroll + pageSize * 0.8
            };

            if (scroll[key] !== undefined) {
                return this._scrollView.scrollTo(scroll[key]);
            }

            // Tab and arrow key navigation
            const navTarget = this._getNavTarget(focused, key);

            if (navTarget) {
                this._scrollView.scrollToChild(navTarget);
                navTarget.grab_key_focus();

                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        _getNavTarget(focused, key) {
            const index = this._appIcons.indexOf(focused);
            const last = this._appIcons.length - 1;

            let targetIndex = index;

            if (index === -1) {
                if (key === Clutter.KEY_Tab) {
                    targetIndex = 0;
                } else if (key === Clutter.KEY_ISO_Left_Tab) {
                    targetIndex = last;
                }
            } else {
                if (key === Clutter.KEY_Tab) {
                    targetIndex = index < last ? index + 1 : 0;
                } else if (key === Clutter.KEY_ISO_Left_Tab) {
                    targetIndex = index > 0 ? index - 1 : last;
                }
            }

            return this._appIcons[targetIndex];
        }

        destroy() {
            this._appSystem.disconnectObject(this);
            this._appFavorites.disconnectObject(this);
            this._parentalControls.disconnectObject(this);
            this._overview.disconnectObject(this);
            this._settings.disconnectObject(this);

            if (this._redisplayLater) {
                this._laters.remove(this._redisplayLater);
            }

            for (const appIcon of this._appIcons) {
                try {
                    appIcon.destroy();
                } catch (e) {}
            }

            super.destroy();
        }
    });

const VerticalScrollView = GObject.registerClass(
    class VerticalScrollView extends St.ScrollView {
        _init(settings) {
            super._init({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.NEVER
            });

            this._settings = settings;
            this._scroll = 0;
            this._scrollAnim = {
                lock: null,
                startTime: 0,
                startValue: 0,
                delta: 0,
                duration: 0
            };
            this._trackpadTime = 0;

            const box = new St.BoxLayout({
                vertical: true,
                x_expand: false,
                y_expand: false
            });

            this._scrollBox = box;
            this.set_child(box);
        }

        add_child(child) {
            this._scrollBox.add_child(child);
        }

        get_child() {
            return this._scrollBox;
        }

        scrollToChild(child) {
            const childBox = child.get_allocation_box();

            // Get the child's vertical position inside the scroll view
            let actor = child;
            let childY = childBox.y1;

            while ((actor = actor.get_parent()) !== this) {
                childY += actor.get_allocation_box().y1;
            }

            // Scroll to keep the child vertically centered
            const adjustment = this.vadjustment;

            const childCenter = childY + childBox.get_height() / 2;
            const scroll = childCenter - adjustment.page_size / 2;

            this.scrollTo(scroll);
        }

        scrollTo(scroll, animate = true, duration = 200) {
            const now = GLib.get_monotonic_time();

            const adjustment = this.vadjustment;
            const anim = this._scrollAnim;

            // Only scroll if the clamped distance is greater than zero to prevent
            // rapidly retriggering the animation while holding down a key
            const min = adjustment.lower;
            const max = adjustment.upper - adjustment.page_size;

            const scrollClamped = Math.clamp(scroll, min, max);
            const distance = Math.abs(this.scroll - scrollClamped);

            if (distance === 0) {
                return Clutter.EVENT_STOP;
            }

            this._scroll = scrollClamped;

            if (animate) {
                // Init scroll animation
                anim.startTime = now;
                anim.startValue = adjustment.value;
                anim.delta = this.scroll - adjustment.value;

                if (anim.lock === null) {
                    anim.lock = global.stage.connect('after-paint', this._scrollAnimationFrame.bind(this));
                    anim.duration = duration * 1000;
                }
            } else {
                // Cancel running animation
                if (anim.lock) {
                    anim.lock = global.stage.disconnect(anim.lock) || null;
                }

                adjustment.value = this.scroll;
            }

            // Redraw to trigger the next animation frame
            this.queue_redraw();

            return Clutter.EVENT_STOP;
        }

        _scrollAnimationFrame() {
            const now = GLib.get_monotonic_time();

            const adjustment = this.vadjustment;
            const anim = this._scrollAnim;

            // Animate towards the scroll target
            const elapsed = now - anim.startTime;
            const progress = Math.clamp(elapsed / anim.duration, 0, 1);

            adjustment.value = anim.startValue + anim.delta * easeOutCubic(progress);

            if (progress >= 1) {
                anim.lock = global.stage.disconnect(anim.lock) || null;
            }

            this.queue_redraw();
        }

        vfunc_scroll_event(event) {
            if (this._settings.get_boolean('animate-scroll')) {
                return this._animateScroll(event);
            }

            return super.vfunc_scroll_event(event);
        }

        _animateScroll(event) {
            const now = GLib.get_monotonic_time();

            // Ignore emulated events
            if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED) {
                return Clutter.EVENT_STOP;
            }

            // Get scroll delta
            const adjustment = this.vadjustment;

            const direction = event.get_scroll_direction();
            const step = adjustment.page_size ** (2 / 3);

            let delta = 0;
            let animate = false;

            if (direction === Clutter.ScrollDirection.SMOOTH) {
                // Sometimes events without a smooth delta are emitted when using a
                // trackpad, so this debounce timestamp is used to prevent any sudden
                // jumps while scrolling
                this._trackpadTime = now;

                delta = event.get_scroll_delta()[Clutter.Orientation.VERTICAL] || 0;
            } else if (now - this._trackpadTime > 1000 * 1000) {
                if (direction === Clutter.ScrollDirection.UP) {
                    delta = -1;
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    delta = 1;
                }

                animate = true;
            }

            // Animate to the new scroll position
            const min = adjustment.lower;
            const max = adjustment.upper - adjustment.page_size;

            const clampedScroll = Math.clamp(this.scroll + delta * step, min, max);
            const distance = Math.abs(this.scroll - clampedScroll);
            const duration = (distance / 100) * 200;

            if (distance === 0) {
                return Clutter.EVENT_STOP;
            }

            return this.scrollTo(clampedScroll, animate, duration);
        }

        destroy() {
            if (this._scrollAnim.lock) {
                global.stage.disconnect(this._scrollAnim.lock);
            }
            super.destroy();
        }

        get scroll() {
            return this._scroll;
        }
    });

const VerticalLayout = GObject.registerClass(
    class VerticalLayout extends Clutter.LayoutManager {
        _init(settings) {
            super._init();

            this._settings = settings;

            settings.connectObject('changed', (_, key) => {
                if (['columns', 'icon-spacing'].includes(key)) {
                    this._columns = settings.get_int('columns');
                    this._spacing = settings.get_int('icon-spacing');

                    this.layout_changed();
                }
            }, this);

            this._columns = settings.get_int('columns');
            this._spacing = settings.get_int('icon-spacing');
        }

        vfunc_get_preferred_width(container, _forHeight) {
            const children = container.get_children();
            const childSize = this._getMinChildSize(children);

            const columns = Math.min(children.length, this._columns);
            const size = columns * childSize + (columns - 1) * this._spacing;

            if (columns) {
                return [size, size];
            }

            return [0, 0];
        }

        vfunc_get_preferred_height(container, _forWidth) {
            const children = container.get_children();
            const childSize = this._getMinChildSize(children);

            const rows = Math.ceil(children.length / this._columns);
            const size = rows * childSize + (rows - 1) * this._spacing;

            if (rows) {
                return [size, size];
            }

            return [0, 0];
        }

        vfunc_allocate(container, _box) {
            const children = container.get_children();
            const childSize = this._getMinChildSize(children);

            const childBox = new Clutter.ActorBox();

            for (let i = 0; i < children.length; i++) {
                const col = i % this._columns;
                const row = Math.floor(i / this._columns);

                const x = col * (childSize + this._spacing);
                const y = row * (childSize + this._spacing);

                const [_minWidth, _minHeight,
                    naturalWidth, naturalHeight
                ] = children[i].get_preferred_size();

                childBox.set_origin(
                    Math.floor(x),
                    Math.floor(y)
                );

                childBox.set_size(
                    Math.max(childSize, naturalWidth),
                    Math.max(childSize, naturalHeight)
                );

                children[i].allocate(childBox);
            }
        }

        _getMinChildSize(children) {
            let minWidth = 0;
            let minHeight = 0;

            children.forEach(child => {
                const childMinHeight = child.get_preferred_height(-1)[0];
                const childMinWidth = child.get_preferred_width(-1)[0];

                minWidth = Math.max(minWidth, childMinWidth);
                minHeight = Math.max(minHeight, childMinHeight);
            });

            return Math.max(minWidth, minHeight);
        }

        destroy() {
            this._settings.disconnectObject(this);
        }
    });