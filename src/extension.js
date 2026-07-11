import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppMenu from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

import {
    Extension,
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {
    InjectionManager
} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    VerticalAppDisplay
} from './appDisplay.js';

export default class VerticalAppGridExtension extends Extension {
    enable() {
        const extension = this;
        const overviewControlsProto = OverviewControls.ControlsManager.prototype;

        this._settings = this.getSettings();
        this._vertAppDisplay = new VerticalAppDisplay(this._settings);
        this._injectionManager = new InjectionManager();

        // Apply workspace visibility preference
        this._updateWorkspacesVisibility = () => {
            try {
                const show = this._settings.get_boolean('show-workspaces');
                const overview = Main.overview && Main.overview._overview;
                if (!overview) return;

                const controls = overview._controls || overview._controlsManager || overview;

                function recurseSet(actor) {
                    try {
                        // Check common name/style hints
                        const name = (actor.get_name && actor.get_name()) || '';
                        const sc = (actor.style_class || (actor.get_style_class_name && actor.get_style_class_name && actor.get_style_class_name()) || '').toString();
                        if ((name && name.toLowerCase().includes('workspace')) || (sc && sc.toLowerCase().includes('workspace')) || (name && name.toLowerCase().includes('switcher'))) {
                            actor.visible = show;
                        }
                    } catch (e) {}

                    try {
                        const children = actor.get_children ? actor.get_children() : [];
                        for (let c of children) recurseSet(c);
                    } catch (e) {}
                }

                recurseSet(controls);
                // Also try top-level viewSelector if present
                if (Main.overview.viewSelector) {
                    try {
                        Main.overview.viewSelector.visible = this._settings.get_boolean('show-workspaces');
                    } catch (e) {}
                }
            } catch (e) {
                log(`Failed to update workspace visibility: ${e}`);
            }
        };

        this._settingsSignal = this._settings.connect('changed::show-workspaces', () => this._updateWorkspacesVisibility());

        // Add the vertical app display to the overview
        this._overviewControls = Main.overview._overview._controls;
        this._overviewLayoutManager = this._overviewControls.layout_manager;

        this._overviewControls.add_child(this._vertAppDisplay);

        // Steal the layout of the original app display
        this._overviewLayoutManager._appDisplay = this._vertAppDisplay;

        this._injectionManager.overrideMethod(overviewControlsProto, '_updateAppDisplayVisibility', () => function(params = null) {
            if (!params) {
                params = this._stateAdjustment.getStateTransitionParams();
            }

            const {
                initialState,
                finalState
            } = params;
            const state = Math.max(initialState, finalState);

            extension._vertAppDisplay.visible =
                state > OverviewControls.ControlsState.WINDOW_PICKER &&
                !this._searchController.searchActive;

            // Focus the vertical app display
            if (extension._vertAppDisplay.visible) {
                global.stage.set_key_focus(extension._vertAppDisplay);
            }

            // Disable drag and drop on the original app grid to prevent internal
            // errors when rearranging app icons in the dash
            extension._overviewControls.appDisplay._disconnectDnD();
        });

        // Fade out the app display when the search becomes active
        this._injectionManager.overrideMethod(overviewControlsProto, '_onSearchChanged', originalFn => function() {
            originalFn.call(this);

            const {
                searchActive
            } = this._searchController;

            extension._vertAppDisplay.ease({
                opacity: searchActive ? 0 : 255,
                duration: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        });

        // Rename the "Pin to Dash" item in the app menu
        this._injectionManager.overrideMethod(AppMenu.AppMenu.prototype, '_updateFavoriteItem', originalFn => function() {
            originalFn.call(this);

            if (this._toggleFavoriteItem.visible) {
                const text = this._appFavorites.isFavorite(this._app.id) ?
                    _('Remove from Favorites') :
                    _('Add to Favorites');

                this._toggleFavoriteItem.label.text = text;
            }
        });
    }

    disable() {
        this._overviewLayoutManager._appDisplay = this._overviewControls.appDisplay;

        this._overviewControls.remove_child(this._vertAppDisplay);
        this._injectionManager.clear();
        this._vertAppDisplay.destroy();

        this._overviewControls.appDisplay._disconnectDnD();
        this._overviewControls.appDisplay._connectDnD();

        // Disconnect settings signal and restore workspace visibility before clearing
        if (this._settingsSignal && this._settings) {
            try {
                this._settings.disconnect(this._settingsSignal);
            } catch (e) {}
            this._settingsSignal = null;
        }

        // Restore workspace visibility when disabling
        try {
            if (this._updateWorkspacesVisibility && this._settings) {
                this._settings.set_boolean('show-workspaces', true);
                this._updateWorkspacesVisibility();
            }
        } catch (e) {}

        this._settings = null;
        this._vertAppDisplay = null;
        this._injectionManager = null;
        this._overviewControls = null;
        this._overviewLayoutManager = null;
    }
}