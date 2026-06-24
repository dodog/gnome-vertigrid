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

import { SIDE_CONTROLS_ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/overviewControls.js';

function easeOutCubic(t) {
  return (--t) * t * t + 1;
}

const CATEGORY_ORDER = [
  'System',
  'Accessories',
  'Development',
  'Education',
  'Games',
  'Graphics',
  'Internet',
  'Multimedia',
  'Office',
  'Science',
  'Settings',
  'Utility',
];

function createCategoryTranslations(_) {
  return {
    'System': _('System'),
    'Accessories': _('Accessories'),
    'Development': _('Development'),
    'Education': _('Education'),
    'Games': _('Games'),
    'Graphics': _('Graphics'),
    'Internet': _('Internet'),
    'Multimedia': _('Multimedia'),
    'Office': _('Office'),
    'Science': _('Science'),
    'Settings': _('Settings'),
    'Utility': _('Utility'),
    'Other': _('Other'),
  };
}

function getAppCategory(appInfo) {
  try {
    const categories = appInfo.get_categories();
    if (!categories)
      return 'Other';

    for (const category of CATEGORY_ORDER) {
      if (categories.includes(category))
        return category;
    }

    const categoryList = categories.split(';');
    for (const cat of categoryList) {
      const trimmed = cat.trim();
      if (trimmed && CATEGORY_ORDER.includes(trimmed))
        return trimmed;
    }
  }
  catch (e) {
    console.error('Error getting app category:', e);
  }
  return 'Other';
}

export const VerticalAppDisplay = GObject.registerClass(
class VerticalAppDisplay extends St.Widget {
  _init(settings, gettext) {
    this._settings = settings;
    this._gettext = gettext;
    this._laters = global.compositor.get_laters();

    super._init({
      layout_manager: new Clutter.BinLayout(),
      can_focus: true,
      reactive: true
    });

    this._scrollView = new VerticalScrollView(settings);

    this.add_child(this._scrollView);

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
    this._appSystem.connectObject('installed-changed', () => {
      this._redisplay();
    }, this);

    this._appFavorites.connectObject('changed', () => {
      this._redisplay();
    }, this);

    this._parentalControls.connectObject('app-filter-changed', () => {
      this._redisplay();
    }, this);

    this._overview.connectObject('hidden', () => {
      this._scrollView.scrollTo(0, false);
    }, this);

    this._settings.connectObject('changed', (_, key) => {
      switch (key) {
        case 'app-sorting':
        case 'favorites-section':
        case 'favorites-sorting':
        case 'category-grouping':
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

    this._categoryLabels = {};
    this._categoryViews = {};
    this._appIcons = [];

    if (categoryGrouping) {
      const categories = this._loadAppsByCategory();

      for (const category of CATEGORY_ORDER) {
        if (!categories[category] || categories[category].length === 0)
          continue;

        let hasNonFavApps = false;
        for (const appId of categories[category]) {
          if (!(favSection && this._appFavorites.isFavorite(appId))) {
            hasNonFavApps = true;
            break;
          }
        }

        if (!hasNonFavApps)
          continue;

        const label = new St.Label({
          style_class: 'search-statustext',
          text: this._gettext(category)
        });

        const view = new St.Viewport({
          layout_manager: new VerticalLayout(this._settings)
        });

        this._categoryLabels[category] = label;
        this._categoryViews[category] = view;

        this._scrollView.add_child(label);
        this._scrollView.add_child(view);

        for (const appId of categories[category]) {
          const app = this._appSystem.lookup_app(appId);
          if (!app)
            continue;

          const appIcon = new AppDisplay.AppIcon(app, { isDraggable: false });
          appIcon.icon.setIconSize(iconSize);

          if (favSection && this._appFavorites.isFavorite(appId)) {
            if (!this._favoritesLabel) {
              this._favoritesLabel = new St.Label({
                style_class: 'search-statustext',
                text: this._gettext('Favorites')
              });
              this._favoritesView = new St.Viewport({
                layout_manager: new VerticalLayout(this._settings)
              });
              this._scrollView.add_child(this._favoritesLabel);
              this._scrollView.add_child(this._favoritesView);
            }
            this._favoritesView.add_child(appIcon);
          } else {
            view.add_child(appIcon);
          }

          this._appIcons.push(appIcon);
        }
      }

      if (categories['Other'] && categories['Other'].length > 0) {
        let hasNonFavApps = false;
        for (const appId of categories['Other']) {
          if (!(favSection && this._appFavorites.isFavorite(appId))) {
            hasNonFavApps = true;
            break;
          }
        }

        if (!hasNonFavApps)
          return;

        const label = new St.Label({
          style_class: 'search-statustext',
          text: this._gettext('Other')
        });

        const view = new St.Viewport({
          layout_manager: new VerticalLayout(this._settings)
        });

        this._categoryLabels['Other'] = label;
        this._categoryViews['Other'] = view;

        this._scrollView.add_child(label);
        this._scrollView.add_child(view);

        for (const appId of categories['Other']) {
          const app = this._appSystem.lookup_app(appId);
          if (!app)
            continue;

          const appIcon = new AppDisplay.AppIcon(app, { isDraggable: false });
          appIcon.icon.setIconSize(iconSize);

          if (favSection && this._appFavorites.isFavorite(appId)) {
            if (!this._favoritesLabel) {
              this._favoritesLabel = new St.Label({
                style_class: 'search-statustext',
                text: this._gettext('Favorites')
              });
              this._favoritesView = new St.Viewport({
                layout_manager: new VerticalLayout(this._settings)
              });
              this._scrollView.add_child(this._favoritesLabel);
              this._scrollView.add_child(this._favoritesView);
            }
            this._favoritesView.add_child(appIcon);
          } else {
            view.add_child(appIcon);
          }

          this._appIcons.push(appIcon);
        }
      }

      if (this._favoritesLabel) {
        const showFav = this._favoritesView.get_children().length > 0;
        this._favoritesLabel.visible = showFav;
        this._favoritesView.visible = showFav;
      }

      for (const category in this._categoryLabels) {
        const view = this._categoryViews[category];
        const showCategory = view.get_children().length > 0;
        this._categoryLabels[category].visible = showCategory;
        view.visible = showCategory;
      }
    } else {
      const apps = this._loadApps();

      for (const appId of apps) {
        const app = this._appSystem.lookup_app(appId);
        if (!app)
          continue;

        const appIcon = new AppDisplay.AppIcon(app, { isDraggable: false });
        appIcon.icon.setIconSize(iconSize);

        if (favSection && this._appFavorites.isFavorite(appId)) {
          if (!this._favoritesLabel) {
            this._favoritesLabel = new St.Label({
              style_class: 'search-statustext',
              text: this._gettext('Favorites')
            });
            this._favoritesView = new St.Viewport({
              layout_manager: new VerticalLayout(this._settings)
            });
            this._scrollView.add_child(this._favoritesLabel);
            this._scrollView.add_child(this._favoritesView);
          }
          this._favoritesView.add_child(appIcon);
        } else {
          if (!this._mainLabel) {
            this._mainLabel = new St.Label({
              style_class: 'search-statustext',
              text: this._gettext('All Apps')
            });
            this._mainView = new St.Viewport({
              layout_manager: new VerticalLayout(this._settings)
            });
            this._scrollView.add_child(this._mainLabel);
            this._scrollView.add_child(this._mainView);
          }
          this._mainView.add_child(appIcon);
        }

        this._appIcons.push(appIcon);
      }

      if (this._favoritesLabel) {
        const showFav = this._favoritesView.get_children().length > 0;
        this._favoritesLabel.visible = showFav;
        this._favoritesView.visible = showFav;
      }

      if (this._mainLabel) {
        const showMain = this._mainView.get_children().length > 0;
        this._mainLabel.visible = showMain;
        this._mainView.visible = showMain;
      }
    }
  }

  _loadAppsByCategory() {
    const installedApps = this._appSystem.get_installed();
    const favSection = this._settings.get_boolean('favorites-section');

    const appsByCategory = {};
    CATEGORY_ORDER.forEach(cat => appsByCategory[cat] = []);
    appsByCategory['Other'] = [];

    installedApps.forEach(appInfo => {
      try {
        const appId = appInfo.get_id();

        if (!this._parentalControls.shouldShowApp(appInfo))
          return;

        if (favSection && this._appFavorites.isFavorite(appId))
          return;

        const category = getAppCategory(appInfo);
        appsByCategory[category].push(appInfo);
      }
      catch (e) {
        console.error('Error loading app:', e);
      }
    });

    const appSorting = this._settings.get_string('app-sorting');

    for (const category in appsByCategory) {
      appsByCategory[category].sort((a, b) => {
        switch (appSorting) {
          case 'usage':
            return this._appUsage.compare(a.get_id(), b.get_id()) ?? 0;

          case 'alphabetical':
          default:
            return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
        }
      });

      appsByCategory[category] = appsByCategory[category].map(appInfo => appInfo.get_id());
    }

    return appsByCategory;
  }

  _loadApps() {
    const installedApps = this._appSystem.get_installed();
    const favSection = this._settings.get_boolean('favorites-section');

    const favs = [];
    const apps = [];

    installedApps.forEach(appInfo => {
      try {
        const appId = appInfo.get_id();
        const isFav = this._appFavorites.isFavorite(appId);

        if (!this._parentalControls.shouldShowApp(appInfo))
          return;

        if (favSection && isFav) {
          favs.push(appInfo);
        } else {
          apps.push(appInfo);
        }
      }
      catch (e) {
        console.error('Error loading app:', e);
      }
    });

    const favSorting = this._settings.get_string('favorites-sorting');
    const favIds = this._appFavorites._getIds();

    favs.sort((a, b) => {
      switch (favSorting) {
        case 'dash':
          return favIds.indexOf(a.get_id()) - favIds.indexOf(b.get_id());

        case 'usage':
          return this._appUsage.compare(a.get_id(), b.get_id()) ?? 0;

        case 'alphabetical':
        default:
          return a.get_name().toLowerCase().localeCompare(b.get_name().toLowerCase());
      }
    });

    const appSorting = this._settings.get_string('app-sorting');

    apps.sort((a, b) => {
      switch (appSorting) {
        case 'usage':
          return this._appUsage.compare(a.get_id(), b.get_id()) ?? 0;

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
        if (this._favoritesLabel) {
          this._favoritesLabel.destroy();
          this._favoritesLabel = null;
        }
        if (this._favoritesView) {
          this._favoritesView.destroy();
          this._favoritesView = null;
        }

        if (this._mainLabel) {
          this._mainLabel.destroy();
          this._mainLabel = null;
        }
        if (this._mainView) {
          this._mainView.destroy();
          this._mainView = null;
        }

        for (const category in this._categoryLabels) {
          this._categoryLabels[category].destroy();
        }
        for (const category in this._categoryViews) {
          this._categoryViews[category].destroy();
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

    if (this._favoritesLabel) {
      this._favoritesLabel.set_style(`margin: 0 0 ${spacing}px 0;`);
    }

    for (const category in this._categoryLabels) {
      this._categoryLabels[category].set_style(`margin: ${spacing * 2}px 0 ${spacing}px 0;`);
    }
  }

  _updateIconSize() {
    const size = this._settings.get_int('icon-size');

    this._appIcons.forEach(appIcon => {
      appIcon.icon.setIconSize(size);
    });
  }

  vfunc_key_press_event(event) {
    const key = event.get_key_symbol();
    const focused = global.stage.get_key_focus();

    if (key === Clutter.KEY_Escape) {
      return Clutter.EVENT_PROPAGATE;
    }

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
      appIcon.destroy();
    }

    super.destroy();
  }
});

const VerticalScrollView = GObject.registerClass(
class VerticalScrollView extends St.ScrollView {
  _init(settings) {
    this._settings = settings;

    this._scroll = 0;
    this._trackpadTime = 0;

    this._scrollAnim = {
      lock: null,
      startTime: 0,
      startValue: 0,
      duration: 0,
      delta: 0
    };

    super._init({
      effect: new St.ScrollViewFade({
        fade_margins: new Clutter.Margin({
          top: 64,
          bottom: 64
        })
      }),
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.NEVER,
      x_expand: true,
      y_expand: true
    });

    this._scrollBox = new St.BoxLayout({
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: false,
      y_expand: false,
      vertical: true
    });

    this.set_child(this._scrollBox);
  }

  add_child(child) {
    this._scrollBox.add_child(child);
  }

  scrollToChild(child) {
    const childBox = child.get_allocation_box();

    let actor = child;
    let childY = childBox.y1;

    while ((actor = actor.get_parent()) !== this) {
      childY += actor.get_allocation_box().y1;
    }

    const adjustment = this.vadjustment;

    const childCenter = childY + childBox.get_height() / 2;
    const scroll = childCenter - adjustment.page_size / 2;

    this.scrollTo(scroll);
  }

  scrollTo(scroll, animate = true, duration = 200) {
    const now = GLib.get_monotonic_time();

    const adjustment = this.vadjustment;
    const anim = this._scrollAnim;

    const min = adjustment.lower;
    const max = adjustment.upper - adjustment.page_size;

    const scrollClamped = Math.clamp(scroll, min, max);
    const distance = Math.abs(this.scroll - scrollClamped);

    if (distance === 0) {
      return Clutter.EVENT_STOP;
    }

    this._scroll = scrollClamped;

    if (animate) {
      anim.startTime = now;
      anim.startValue = adjustment.value;
      anim.delta = this.scroll - adjustment.value;

      if (anim.lock === null) {
        anim.lock = global.stage.connect('after-paint', this._scrollAnimationFrame.bind(this));
        anim.duration = duration * 1000;
      }
    } else {
      if (anim.lock) {
        anim.lock = global.stage.disconnect(anim.lock) || null;
      }

      adjustment.value = this.scroll;
    }

    this.queue_redraw();

    return Clutter.EVENT_STOP;
  }

  _scrollAnimationFrame() {
    const now = GLib.get_monotonic_time();

    const adjustment = this.vadjustment;
    const anim = this._scrollAnim;

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

    if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED) {
      return Clutter.EVENT_STOP;
    }

    const adjustment = this.vadjustment;

    const direction = event.get_scroll_direction();
    const step = adjustment.page_size ** (2 / 3);

    let delta = 0;
    let animate = false;

    if (direction === Clutter.ScrollDirection.SMOOTH) {
      this._trackpadTime = now;

      delta = event.get_scroll_delta()[Clutter.Orientation.VERTICAL] ?? 0;
    } else if (now - this._trackpadTime > 1000 * 1000) {
      if (direction === Clutter.ScrollDirection.UP) {
        delta = -1;
      } else if (direction === Clutter.ScrollDirection.DOWN) {
        delta = 1;
      }

      animate = true;
    }

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
        naturalWidth, naturalHeight] = children[i].get_preferred_size();

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