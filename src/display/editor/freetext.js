/* Copyright 2022 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// eslint-disable-next-line max-len
/** @typedef {import("./annotation_editor_layer.js").AnnotationEditorLayer} AnnotationEditorLayer */

import {
  addOpacityToColor,
  AnnotationEditorParamsType,
  AnnotationEditorType,
  assert,
  LINE_FACTOR,
  shadow,
  Util,
} from "../../shared/util.js";
import {
  AnnotationEditorUIManager,
  bindEvents,
  KeyboardManager,
} from "./tools.js";
import { AnnotationEditor } from "./editor.js";
import { FreeTextAnnotationElement } from "../annotation_layer.js";

const EOL_PATTERN = /\r\n?|\n/g;

function normalizeOpacity(opacity, fallback = 1) {
  const normalizedFallback =
    typeof fallback === "number" && Number.isFinite(fallback)
      ? Math.min(1, Math.max(0, fallback))
      : 1;
  return typeof opacity === "number" && Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity))
    : normalizedFallback;
}

/**
 * Basic text editor in order to create a FreeTex annotation.
 */
class FreeTextEditor extends AnnotationEditor {
  #color;

  #content = "";

  #contentBeforeEdit = null;

  #drawId = null;

  #drawLayer = null;

  #editorDivId = `${this.id}-editor`;

  #editModeAC = null;

  #fontSize;

  #isComposing = false;

  #measureDiv = null;

  #measurementRaf = null;

  #isShown = true;

  #hasFixedWidth = false;

  #hasFixedHeight = false;

  opacity;

  #textParams = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    alignment: "left",
  };

  static _freeTextDefaultContent = "";

  static _internalPadding = 0;

  static _defaultColor = "#000000";

  static _defaultFontSize = 14;

  static _defaultOpacity = 1;

  static _defaultTextParams = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    alignment: "left",
  };

  static get _keyboardManager() {
    const proto = FreeTextEditor.prototype;

    const arrowChecker = self => self.isEmpty();

    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;

    return shadow(
      this,
      "_keyboardManager",
      new KeyboardManager([
        [
          // Commit the text in case the user use ctrl+s to save the document.
          // The event must bubble in order to be caught by the viewer.
          // See bug 1831574.
          ["ctrl+s", "mac+meta+s", "ctrl+p", "mac+meta+p"],
          proto.commitOrRemove,
          { bubbles: true },
        ],
        [
          ["ctrl+Enter", "mac+meta+Enter", "Escape", "mac+Escape"],
          proto.commitOrRemove,
        ],
        // [
        //   ["ArrowLeft", "mac+ArrowLeft"],
        //   proto._translateEmpty,
        //   { args: [-small, 0], checker: arrowChecker },
        // ],
        [
          ["ctrl+ArrowLeft", "mac+shift+ArrowLeft"],
          proto._translateEmpty,
          { args: [-big, 0], checker: arrowChecker },
        ],
        // [
        //   ["ArrowRight", "mac+ArrowRight"],
        //   proto._translateEmpty,
        //   { args: [small, 0], checker: arrowChecker },
        // ],
        [
          ["ctrl+ArrowRight", "mac+shift+ArrowRight"],
          proto._translateEmpty,
          { args: [big, 0], checker: arrowChecker },
        ],
        // [
        //   ["ArrowUp", "mac+ArrowUp"],
        //   proto._translateEmpty,
        //   { args: [0, -small], checker: arrowChecker },
        // ],
        [
          ["ctrl+ArrowUp", "mac+shift+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -big], checker: arrowChecker },
        ],
        // [
        //   ["ArrowDown", "mac+ArrowDown"],
        //   proto._translateEmpty,
        //   { args: [0, small], checker: arrowChecker },
        // ],
        [
          ["ctrl+ArrowDown", "mac+shift+ArrowDown"],
          proto._translateEmpty,
          { args: [0, big], checker: arrowChecker },
        ],
      ])
    );
  }

  static _type = "freetext";

  static _editorType = AnnotationEditorType.FREETEXT;

  constructor(params) {
    super({ ...params, name: "freeTextEditor" });
    this.#color =
      params.color ||
      FreeTextEditor._defaultColor ||
      AnnotationEditor._defaultLineColor;
    this.#fontSize = params.fontSize || FreeTextEditor._defaultFontSize;
    this.opacity = normalizeOpacity(
      params.opacity ?? FreeTextEditor._defaultOpacity,
      FreeTextEditor._defaultOpacity
    );
    this.#textParams = params.textParams || {
      ...FreeTextEditor._defaultTextParams,
    };
  }

  get _supportsPageConstrainedDragging() {
    return true;
  }

  /** @inheritdoc */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    const style = getComputedStyle(document.documentElement);

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      const lineHeight = parseFloat(
        style.getPropertyValue("--freetext-line-height")
      );
      assert(
        lineHeight === LINE_FACTOR,
        "Update the CSS variable to agree with the constant."
      );
    }

    this._internalPadding = parseFloat(
      style.getPropertyValue("--freetext-padding")
    );
  }

  /** @inheritdoc */
  // 相当于记录面板配置，之后新的editor都按照这个参数配置走
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.FREETEXT_SIZE:
        FreeTextEditor._defaultFontSize = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_COLOR:
        FreeTextEditor._defaultColor = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_OPACITY:
        FreeTextEditor._defaultOpacity = normalizeOpacity(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_BOLD:
        FreeTextEditor._defaultTextParams.bold = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_ITALIC:
        FreeTextEditor._defaultTextParams.italic = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_UNDERLINE:
        FreeTextEditor._defaultTextParams.underline = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_STRIKETHROUGH:
        FreeTextEditor._defaultTextParams.strikethrough = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_ALIGNMENT:
        FreeTextEditor._defaultTextParams.alignment = value;
        break;
    }
  }

  /** @inheritdoc */
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.FREETEXT_SIZE:
        this.#updateFontSize(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_COLOR:
        this.#updateColor(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_OPACITY:
        this.#updateOpacity(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_BOLD:
        this.#updateBold(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_ITALIC:
        this.#updateItalic(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_UNDERLINE:
        this.#updateUnderline(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_STRIKETHROUGH:
        this.#updateStrikethrough(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_ALIGNMENT:
        this.#updateAlignment(value);
        break;
    }
  }

  /** @inheritdoc */
  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.FREETEXT_SIZE,
        FreeTextEditor._defaultFontSize,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_COLOR,
        FreeTextEditor._defaultColor || AnnotationEditor._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_OPACITY,
        FreeTextEditor._defaultOpacity,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_BOLD,
        FreeTextEditor._defaultTextParams.bold,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_ITALIC,
        FreeTextEditor._defaultTextParams.italic,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_UNDERLINE,
        FreeTextEditor._defaultTextParams.underline,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_STRIKETHROUGH,
        FreeTextEditor._defaultTextParams.strikethrough,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_ALIGNMENT,
        FreeTextEditor._defaultTextParams.alignment,
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.FREETEXT_SIZE,
        this.#fontSize || FreeTextEditor._defaultFontSize,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_COLOR,
        this.#color || FreeTextEditor._defaultColor,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_OPACITY,
        this.opacity ?? FreeTextEditor._defaultOpacity,
      ],
      [AnnotationEditorParamsType.FREETEXT_BOLD, this.#textParams.bold],
      [AnnotationEditorParamsType.FREETEXT_ITALIC, this.#textParams.italic],
      [
        AnnotationEditorParamsType.FREETEXT_UNDERLINE,
        this.#textParams.underline,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_STRIKETHROUGH,
        this.#textParams.strikethrough,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_ALIGNMENT,
        this.#textParams.alignment,
      ],
    ];
  }

  /**
   * Update the font size and make this action as undoable.
   * @param {number} fontSize
   */
  #updateFontSize(fontSize) {
    let savedState;
    let newState;
    const setFontSize = () => {
      if (newState) {
        this.#restoreFontSizeState(newState);
        return;
      }
      savedState = this.#setFontSizeAndKeepVisualPosition(fontSize);
      newState = this.#captureFontSizeState();
    };
    this.addCommands({
      cmd: setFontSize,
      undo: () => this.#restoreFontSizeState(savedState),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_SIZE,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  #captureFontSizeState() {
    return {
      fontSize: this.#fontSize,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      hasFixedWidth: this.#hasFixedWidth,
      hasFixedHeight: this.#hasFixedHeight,
      styleWidth: this.div?.style.width ?? "",
      styleHeight: this.div?.style.height ?? "",
    };
  }

  #restoreFontSizeState(state) {
    if (!state) {
      return;
    }
    this.#cancelPendingMeasurement();
    this.#fontSize = state.fontSize;
    if (this.editorDiv) {
      this.editorDiv.style.fontSize = `calc(${state.fontSize}px * var(--total-scale-factor))`;
    }
    this.x = state.x;
    this.y = state.y;
    this.width = state.width;
    this.height = state.height;
    this.#hasFixedWidth = state.hasFixedWidth;
    this.#hasFixedHeight = state.hasFixedHeight;

    if (this.div) {
      if (this.parent) {
        const [parentWidth, parentHeight] = this.parentDimensions;
        this.setDims(parentWidth * state.width, parentHeight * state.height);
      }
      this.div.style.width = state.styleWidth;
      this.div.style.height = state.styleHeight;
      if (this.parent) {
        this.fixAndSetPosition();
      }
    }
    this.#updateMeasureContent();
    this.#syncDrawLayer();
  }

  static #isValidRect(rect) {
    return (
      rect !== null &&
      [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  #setFontSize(size) {
    this.#fontSize = size;
    if (this.editorDiv) {
      this.editorDiv.style.fontSize = `calc(${size}px * var(--total-scale-factor))`;
    }
  }

  #setFontSizeAndKeepVisualPosition(size) {
    this.#cancelPendingMeasurement();
    const { div, editorDiv, parent } = this;
    if (!div || !editorDiv || !parent) {
      const savedState = this.#captureFontSizeState();
      this.#setFontSize(size);
      this.#syncDrawLayer();
      return savedState;
    }

    let rect = div.getBoundingClientRect();
    if (
      !this.isAttachedToDOM ||
      !div.isConnected ||
      div.classList.contains("hidden") ||
      !FreeTextEditor.#isValidRect(rect)
    ) {
      return this.#setFontSizeInTemporaryLayout(size);
    }

    this.#flushPendingMeasurement(/* force = */ true);
    rect = div.getBoundingClientRect();
    if (!FreeTextEditor.#isValidRect(rect)) {
      return this.#setFontSizeInTemporaryLayout(size);
    }

    const savedState = this.#captureFontSizeState();
    const { left, top } = rect;
    this.#setFontSize(size);

    // Translating can change the available line width. Keep the correction
    // bounded so content close to a page edge cannot oscillate indefinitely.
    for (let i = 0; i < 2; i++) {
      this.#flushPendingMeasurement(/* force = */ true);
      rect = div.getBoundingClientRect();
      if (!FreeTextEditor.#isValidRect(rect)) {
        break;
      }
      const deltaX = left - rect.left;
      const deltaY = top - rect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        break;
      }
      this.translate(deltaX, deltaY);
    }
    this.#flushPendingMeasurement(/* force = */ true);
    this.#syncDrawLayer();
    return savedState;
  }

  #setFontSizeInTemporaryLayout(size) {
    const savedState = this.#captureFontSizeState();
    const { div, parent } = this;
    if (!div || !this.editorDiv || !parent?.div?.isConnected) {
      this.#setFontSize(size);
      this.#syncDrawLayer();
      return savedState;
    }

    const originalParent = div.parentNode;
    const originalNextSibling = div.nextSibling;
    const savedAttached = this.isAttachedToDOM;
    const savedHidden = div.classList.contains("hidden");
    const savedDisplay = div.style.display;
    const savedVisibility = div.style.visibility;
    try {
      div.classList.remove("hidden");
      div.style.display = "";
      div.style.visibility = "hidden";
      parent.div.append(div);
      this.isAttachedToDOM = true;

      const rect = div.getBoundingClientRect();
      if (!FreeTextEditor.#isValidRect(rect)) {
        this.#setFontSize(size);
        this.#syncDrawLayer();
        return savedState;
      }

      this.#flushPendingMeasurement(/* force = */ true);
      Object.assign(savedState, this.#captureFontSizeState());
      this.#setFontSize(size);
      this.#flushPendingMeasurement(/* force = */ true);

      // There is no visual anchor while the editor is hidden or detached.
      // Preserve its normalized page position and only update its dimensions.
      this.x = savedState.x;
      this.y = savedState.y;
      this.#syncDrawLayer();
      return savedState;
    } finally {
      this.isAttachedToDOM = savedAttached;
      div.classList.toggle("hidden", savedHidden);
      div.style.display = savedDisplay;
      div.style.visibility = savedVisibility;
      if (originalParent) {
        originalParent.insertBefore(div, originalNextSibling);
      } else {
        div.remove();
      }
    }
  }

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color) {
    const setColor = col => {
      this.#color = this.editorDiv.style.color = addOpacityToColor(
        col,
        this.opacity
      );
      this.#syncDrawLayer();
    };
    const savedColor = this.#color;
    this.addCommands({
      cmd: setColor.bind(this, color),
      undo: setColor.bind(this, savedColor),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_COLOR,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the opacity and make this action undoable.
   * @param {number} opacity
   */
  #updateOpacity(opacity) {
    const setOpacity = opa => {
      opa = normalizeOpacity(opa);
      this.editorDiv.style.color = addOpacityToColor(this.#color, opa);
      this.opacity = opa;
      this.#syncDrawLayer();
    };
    const savedOpacity = this.opacity;
    this.addCommands({
      cmd: setOpacity.bind(this, opacity),
      undo: setOpacity.bind(this, savedOpacity),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_OPACITY,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the bold and make this action undoable.
   * @param {boolean} bold
   */
  #updateBold(bold) {
    const setBold = bol => {
      this.editorDiv.style.fontWeight = bol ? "bold" : "normal";
      this.#textParams.bold = bol;
      this.#scheduleMeasurement();
      this.#syncDrawLayer();
    };
    const savedBold = this.#textParams.bold;
    this.addCommands({
      cmd: setBold.bind(this, bold),
      undo: setBold.bind(this, savedBold),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_BOLD,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the Italic and make this action undoable.
   * @param {boolean} Italic
   */
  #updateItalic(italic) {
    const setItalic = ital => {
      this.editorDiv.style.fontStyle = ital ? "italic" : "normal";
      this.#textParams.italic = ital;
      this.#scheduleMeasurement();
      this.#syncDrawLayer();
    };
    const savedItalic = this.#textParams.italic;
    this.addCommands({
      cmd: setItalic.bind(this, italic),
      undo: setItalic.bind(this, savedItalic),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_ITALIC,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the underline and make this action undoable.
   * @param {boolean} underline
   */
  #updateUnderline(underline) {
    const setUnderline = under => {
      this.editorDiv.style.textDecoration = under ? "underline" : "none";
      this.#textParams.underline = under;
      if (under && this.#textParams.strikethrough) {
        this.#textParams.strikethrough = false;
      }
      this.#syncDrawLayer();
    };
    const savedUnderline = this.#textParams.underline;
    this.addCommands({
      cmd: setUnderline.bind(this, underline),
      undo: setUnderline.bind(this, savedUnderline),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_UNDERLINE,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the strikethrough and make this action undoable.
   * @param {boolean} strikethrough
   */
  #updateStrikethrough(strikethrough) {
    const setStrikethrough = strik => {
      this.editorDiv.style.textDecoration = strik ? "line-through" : "none";
      this.#textParams.strikethrough = strik;
      if (strik && this.#textParams.underline) {
        this.#textParams.underline = false;
      }
      this.#syncDrawLayer();
    };
    const savedStrikethrough = this.#textParams.strikethrough;
    this.addCommands({
      cmd: setStrikethrough.bind(this, strikethrough),
      undo: setStrikethrough.bind(this, savedStrikethrough),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_STRIKETHROUGH,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Update the alignment and make this action undoable.
   * @param {string} alignment
   */
  #updateAlignment(alignment) {
    const setAlignment = align => {
      this.editorDiv.style.textAlign = align;
      this.#textParams.alignment = align;
      this.#syncDrawLayer();
    };
    const savedAlignment = this.#textParams.alignment;
    this.addCommands({
      cmd: setAlignment.bind(this, alignment),
      undo: setAlignment.bind(this, savedAlignment),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.FREETEXT_ALIGNMENT,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * Helper to translate the editor with the keyboard when it's empty.
   * @param {number} x in page units.
   * @param {number} y in page units.
   */
  _translateEmpty(x, y) {
    this._uiManager.translateSelectedEditors(x, y, /* noCommit = */ true);
  }

  /** @inheritdoc */
  setAt(x, y, tx, ty) {
    super.setAt(x, y, tx, ty);
    this.#syncDrawLayer();
  }

  /** @inheritdoc */
  _onTranslating(_x, _y) {
    this.#syncDrawLayer();
  }

  /** @inheritdoc */
  _onTranslated(_x, _y) {
    this.#syncDrawLayer();
  }

  _onStartResizing() {
    this._editToolbar?.hide();
  }

  _onResizing() {
    this.#hasFixedWidth = true;
    this.#hasFixedHeight = true;
    this.#updateMeasureContent();
    this.#syncDrawLayer();
  }

  _onResized() {
    if (!this.#hasFixedWidth) {
      this.div.style.width = "auto";
    }
    if (!this.#hasFixedHeight) {
      this.div.style.height = "auto";
    }
    this.#flushPendingMeasurement();
  }

  _onStopResizing() {
    this.#flushPendingMeasurement();
    if (this.isSelected) {
      this._editToolbar?.show();
    }
  }

  _getResizeState() {
    return {
      hasFixedWidth: this.#hasFixedWidth,
      hasFixedHeight: this.#hasFixedHeight,
    };
  }

  _setResizeState(state) {
    if (state) {
      this.#hasFixedWidth = state.hasFixedWidth;
      this.#hasFixedHeight = state.hasFixedHeight;
    }
  }

  _constrainResize(_name, width, height) {
    return [
      width,
      Math.min(1, Math.max(height, this.#getMinimumContentHeight(width))),
    ];
  }

  /** @inheritdoc */
  get isResizable() {
    return true;
  }

  /** @inheritdoc */
  get resizerNames() {
    return [
      "topLeft",
      "topMiddle",
      "topRight",
      "middleRight",
      "bottomRight",
      "bottomMiddle",
      "bottomLeft",
      "middleLeft",
    ];
  }

  /** @inheritdoc */
  rotate(angle) {
    this.#syncDrawLayer(angle);
  }

  /** @inheritdoc */
  show(visible = this._isVisible) {
    this.#isShown = visible;
    super.show(visible);
    this.#syncDrawLayer();
  }

  /** @inheritdoc */
  getInitialTranslation() {
    // The start of the base line is where the user clicked.
    const scale = this.parentScale;
    return [
      -FreeTextEditor._internalPadding * scale,
      -(FreeTextEditor._internalPadding + this.#fontSize) * scale,
    ];
  }

  /** @inheritdoc */
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }
    this.rotate(this.parent.viewport.rotation);
    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
    this.#syncDrawLayer();
  }

  setParent(parent) {
    const oldDrawLayer = this.#drawLayer || this.parent?.drawLayer;
    const newDrawLayer = parent?.drawLayer || null;

    if (this.#drawId !== null) {
      if (oldDrawLayer && newDrawLayer && oldDrawLayer !== newDrawLayer) {
        oldDrawLayer.updateParent(this.#drawId, newDrawLayer);
      } else if (!newDrawLayer) {
        oldDrawLayer?.remove(this.#drawId);
        this.#drawId = null;
      }
    }
    this.#drawLayer = newDrawLayer;
    super.setParent(parent);
    if (parent) {
      this.#syncDrawLayer();
    }
  }

  /** @inheritdoc */
  enableEditMode(global = true) {
    if (this.isInEditMode()) {
      return;
    }

    // 如果编辑器已被移除（parent 为 null），直接返回
    if (!this.parent) {
      return;
    }
    this.parent.setEditingState(false);
    // 如果是全局开启模式，执行更新toolbar和模式
    if (global) {
      this.parent.updateToolbar(AnnotationEditorType.FREETEXT);
    }
    super.enableEditMode();
    this.#contentBeforeEdit ??= this.#content;
    this.overlayDiv.classList.remove("enabled");
    this.editorDiv.readOnly = false;
    this.div.classList.add("editing");
    this.#syncDrawLayer();
    this._isDraggable = false;
    this.div.removeAttribute("aria-activedescendant");

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        !this.#editModeAC,
        "No `this.#editModeAC` AbortController should exist."
      );
    }
    this.#editModeAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#editModeAC);

    this.editorDiv.addEventListener(
      "keydown",
      this.editorDivKeydown.bind(this),
      { signal }
    );
    this.editorDiv.addEventListener("focus", this.editorDivFocus.bind(this), {
      signal,
    });
    this.editorDiv.addEventListener("blur", this.editorDivBlur.bind(this), {
      signal,
    });
    this.editorDiv.addEventListener("input", this.editorDivInput.bind(this), {
      signal,
    });
    this.editorDiv.addEventListener(
      "compositionstart",
      this.editorDivCompositionStart.bind(this),
      { signal }
    );
    this.editorDiv.addEventListener(
      "compositionend",
      this.editorDivCompositionEnd.bind(this),
      { signal }
    );
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode()) {
      return;
    }

    this.parent.setEditingState(true);
    super.disableEditMode();
    this.overlayDiv.classList.add("enabled");
    this.editorDiv.readOnly = true;
    this.div.classList.remove("editing");
    this.div.setAttribute("aria-activedescendant", this.#editorDivId);
    this._isDraggable = true;

    this.#editModeAC?.abort();
    this.#editModeAC = null;
    this.#setCompositionState(false, this.#isComposing);

    // Keep keyboard focus on the editor container after making the textarea
    // read-only.
    this.div.focus({
      preventScroll: true /* See issue #15744 */,
    });

    // In case the blur callback hasn't been called.
    this.isEditing = false;
    this.parent.div.classList.add("freetextEditing");
    this.#syncDrawLayer();
  }

  /** @inheritdoc */
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    // super.focusin(event);
    if (event.target !== this.editorDiv) {
      this.editorDiv.focus();
    }
  }

  /** @inheritdoc */
  onceAdded(focus) {
    if (this.width) {
      // The editor was created in using ctrl+c.
      return;
    }
    this.enableEditMode();
    if (focus) {
      this.editorDiv.focus();
    }
    if (this._initialOptions?.isCentered) {
      this.center();
    }
    this._initialOptions = null;
  }

  /** @inheritdoc */
  isEmpty() {
    return this.#content.trim() === "";
  }

  /** @inheritdoc */
  commitOrRemove() {
    if (
      this.isEmpty() &&
      !(this.isInEditMode() && this.#contentBeforeEdit?.trim())
    ) {
      this.remove();
    } else {
      this.commit();
    }
  }

  /** @inheritdoc */
  remove() {
    this.isEditing = false;
    this.#setCompositionState(false);
    this.#cancelPendingMeasurement();
    this.#cleanDrawLayer();
    super.remove();
    // super.remove() can commit a non-empty editor. Committing exits edit mode
    // and may recreate its SVG projection, so always clean once more after the
    // editor has been detached.
    this.#cleanDrawLayer();
  }

  #setEditorDimensions() {
    if (!this.parent || !this.div) {
      return;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;

    if (this.#hasFixedHeight) {
      const minHeight = this.#getMinimumContentHeight(
        this.width,
        /* updateMeasure = */ false
      );
      if (minHeight > this.height) {
        this.height = minHeight;
        this.setDims(parentWidth * this.width, parentHeight * this.height);
        if (!this.#isComposing) {
          this.fixAndSetPosition();
        }
      }
    }

    let rect;
    if (this.isAttachedToDOM) {
      rect = this.div.getBoundingClientRect();
    } else {
      // This editor isn't on screen but we need to get its dimensions, so
      // we just insert it in the DOM, get its bounding box and then remove it.
      const { currentLayer, div } = this;
      const savedDisplay = div.style.display;
      const savedVisibility = div.classList.contains("hidden");
      div.classList.remove("hidden");
      div.style.display = "hidden";
      currentLayer.div.append(this.div);
      rect = div.getBoundingClientRect();
      div.remove();
      div.style.display = savedDisplay;
      div.classList.toggle("hidden", savedVisibility);
    }

    // The dimensions are relative to the rotation of the page, hence we need to
    // take that into account (see issue #16636).
    if (this.rotation % 180 === this.parentRotation % 180) {
      this.width = rect.width / parentWidth;
      this.height = rect.height / parentHeight;
    } else {
      this.width = rect.height / parentWidth;
      this.height = rect.width / parentHeight;
    }
    if (!this.#isComposing) {
      this.fixAndSetPosition();
    }
    this.#syncDrawLayer();
  }

  #scheduleMeasurement(allowDuringComposition = false) {
    if (this.#isComposing && !allowDuringComposition) {
      return;
    }
    this.#updateMeasureContent();
    if (this.#measurementRaf !== null) {
      return;
    }
    this.#measurementRaf = requestAnimationFrame(() => {
      this.#measurementRaf = null;
      this.#setEditorDimensions();
    });
  }

  #cancelPendingMeasurement() {
    if (this.#measurementRaf === null) {
      return;
    }
    cancelAnimationFrame(this.#measurementRaf);
    this.#measurementRaf = null;
  }

  #flushPendingMeasurement(force = false) {
    if (this.#isComposing && !force) {
      return;
    }
    this.#cancelPendingMeasurement();
    this.#updateMeasureContent();
    this.#setEditorDimensions();
  }

  #setCompositionState(isComposing, measure = false) {
    if (this.editorDiv) {
      this.#content = this.editorDiv.value.replaceAll(EOL_PATTERN, "\n");
    }

    if (isComposing) {
      this.#cancelPendingMeasurement();
      this.#isComposing = true;

      let useNoWrap = false;
      if (this.#measureDiv && !this.#content.includes("\n")) {
        const height = this.#measureDiv.offsetHeight;
        const lineHeight = parseFloat(
          getComputedStyle(this.#measureDiv).lineHeight
        );
        useNoWrap =
          Number.isFinite(lineHeight) && height <= Math.ceil(lineHeight) + 1;
      }
      this.div?.classList.toggle("imeComposingNoWrap", useNoWrap);
      return;
    }

    this.#isComposing = false;
    this.div?.classList.remove("imeComposingNoWrap");
    if (measure) {
      this.#scheduleMeasurement();
    }
  }

  #getMinimumContentHeight(candidateWidth, updateMeasure = true) {
    if (!this.#measureDiv) {
      return 0;
    }
    if (updateMeasure) {
      this.#updateMeasureContent(candidateWidth, /* forceFixedWidth = */ true);
    }
    const padding = FreeTextEditor._internalPadding * this.parentScale;
    const [, parentHeight] = this.parentDimensions;
    return Math.min(
      1,
      (this.#measureDiv.offsetHeight + 2 * padding) / parentHeight
    );
  }

  #updateMeasureContent(candidateWidth = this.width, forceFixedWidth = false) {
    if (this.#measureDiv) {
      const { style } = this.editorDiv;
      for (const name of [
        "fontSize",
        "fontWeight",
        "fontStyle",
        "textDecoration",
        "textAlign",
      ]) {
        this.#measureDiv.style[name] = style[name];
      }

      const [parentWidth, parentHeight] = this.parentDimensions;
      let availableWidth;
      switch (this.rotation) {
        case 90:
          availableWidth = this.y * parentHeight;
          break;
        case 180:
          availableWidth = this.x * parentWidth;
          break;
        case 270:
          availableWidth = (1 - this.y) * parentHeight;
          break;
        default:
          availableWidth = (1 - this.x) * parentWidth;
          break;
      }
      const padding = FreeTextEditor._internalPadding * this.parentScale;
      const maxContentWidth = Math.max(1, availableWidth - 2 * padding);
      this.#measureDiv.style.maxWidth = `${maxContentWidth}px`;
      this.#measureDiv.style.width =
        this.#hasFixedWidth || forceFixedWidth
          ? `${
              forceFixedWidth
                ? Math.max(1, candidateWidth * parentWidth - 2 * padding)
                : Math.min(
                    maxContentWidth,
                    Math.max(1, candidateWidth * parentWidth - 2 * padding)
                  )
            }px`
          : "max-content";

      // The zero-width character makes a final empty line participate in
      // layout without changing the displayed or serialized value.
      this.#measureDiv.textContent =
        !this.#content || this.#content.endsWith("\n")
          ? `${this.#content}\u200b`
          : this.#content;
    }
  }

  #getDrawLayerGeometry(
    viewportRotation = this.parent?.viewport.rotation ?? this.parentRotation
  ) {
    const {
      x,
      y,
      width,
      height,
      rotation,
      parentDimensions: [pW, pH],
    } = this;
    viewportRotation = ((viewportRotation % 360) + 360) % 360;
    let bbox;
    switch ((rotation * 4 + viewportRotation) / 90) {
      case 1:
        bbox = [1 - y - height, x, height, width];
        break;
      case 2:
        bbox = [1 - x - width, 1 - y - height, width, height];
        break;
      case 3:
        bbox = [y, 1 - x - width, height, width];
        break;
      case 4:
        bbox = [
          x,
          y - width * (pW / pH),
          height * (pH / pW),
          width * (pW / pH),
        ];
        break;
      case 5:
        bbox = [1 - y, x, width * (pW / pH), height * (pH / pW)];
        break;
      case 6:
        bbox = [
          1 - x - height * (pH / pW),
          1 - y,
          height * (pH / pW),
          width * (pW / pH),
        ];
        break;
      case 7:
        bbox = [
          y - width * (pW / pH),
          1 - x - height * (pH / pW),
          width * (pW / pH),
          height * (pH / pW),
        ];
        break;
      case 8:
        bbox = [x - width, y - height, width, height];
        break;
      case 9:
        bbox = [1 - y, x - width, height, width];
        break;
      case 10:
        bbox = [1 - x, 1 - y, width, height];
        break;
      case 11:
        bbox = [y - height, 1 - x, height, width];
        break;
      case 12:
        bbox = [
          x - height * (pH / pW),
          y,
          height * (pH / pW),
          width * (pW / pH),
        ];
        break;
      case 13:
        bbox = [
          1 - y - width * (pW / pH),
          x - height * (pH / pW),
          width * (pW / pH),
          height * (pH / pW),
        ];
        break;
      case 14:
        bbox = [
          1 - x,
          1 - y - width * (pW / pH),
          height * (pH / pW),
          width * (pW / pH),
        ];
        break;
      case 15:
        bbox = [y, 1 - x, width * (pW / pH), height * (pH / pW)];
        break;
      default:
        bbox = [x, y, width, height];
        break;
    }
    const contentRotation = (viewportRotation - rotation + 360) % 360;
    let contentSize = { width: 100, height: 100 };
    if (contentRotation % 180 !== 0) {
      // bbox is relative to CanvasWrapper. Its dimensions are swapped when
      // the viewport is rotated by an odd multiple of 90 degrees, while pW
      // and pH always describe the unrotated page. Using the latter directly
      // produces an oversized content box which is then clipped by the SVG
      // foreignObject on intrinsically rotated pages.
      const [canvasWidth, canvasHeight] =
        viewportRotation % 180 === 0 ? [pW, pH] : [pH, pW];
      const rootWidth = bbox[2] * canvasWidth;
      const rootHeight = bbox[3] * canvasHeight;
      if (rootWidth > 0 && rootHeight > 0) {
        // The root bbox is already rotated into CanvasWrapper coordinates.
        // Rotate the XHTML content inside it using the opposite dimensions.
        contentSize = {
          width: (100 * rootHeight) / rootWidth,
          height: (100 * rootWidth) / rootHeight,
        };
      }
    }
    return {
      bbox: {
        x: bbox[0],
        y: bbox[1],
        width: bbox[2],
        height: bbox[3],
      },
      contentRotation,
      contentSize,
    };
  }

  #getDrawLayerStyle() {
    return {
      fontSize: this.#fontSize,
      color: addOpacityToColor(this.#color, this.opacity),
      fontWeight: this.#textParams.bold ? "bold" : "normal",
      fontStyle: this.#textParams.italic ? "italic" : "normal",
      textDecoration: this.#textParams.underline
        ? "underline"
        : this.#textParams.strikethrough
          ? "line-through"
          : "none",
      textAlign: this.#textParams.alignment,
      lineHeight: LINE_FACTOR,
    };
  }

  #syncDrawLayer(viewportRotation) {
    const drawLayer = this.parent?.drawLayer || this.#drawLayer;
    if (!drawLayer || !this.#content || !this.width || !this.height) {
      return;
    }
    this.#drawLayer = drawLayer;
    const properties = {
      ...this.#getDrawLayerGeometry(viewportRotation),
      value: this.#content,
      style: this.#getDrawLayerStyle(),
      hidden: this.isInEditMode() || !this.#isShown,
    };
    if (this.#drawId === null) {
      this.#drawId = drawLayer.drawText(properties);
    } else {
      drawLayer.updateText(this.#drawId, properties);
    }
  }

  #cleanDrawLayer() {
    if (this.#drawId === null) {
      return;
    }
    this.#drawLayer?.remove(this.#drawId);
    this.#drawId = null;
  }

  /**
   * Commit the content we have in this editor.
   * @returns {undefined}
   */
  commit() {
    if (!this.isInEditMode()) {
      return;
    }

    this.#setCompositionState(false);
    this.#flushPendingMeasurement(/* force = */ true);
    const savedText = this.#contentBeforeEdit ?? this.#content;
    const newText = this.#content;
    super.commit();
    this.disableEditMode();
    this.#contentBeforeEdit = null;
    if (savedText === newText) {
      this.#syncDrawLayer();
      return;
    }

    const setText = text => {
      this.#content = text;
      this.#setContent();
      if (!text) {
        this.remove();
        return;
      }
      this._uiManager.rebuild(this);
      this.#flushPendingMeasurement();
      this.#syncDrawLayer();
    };
    this.addCommands({
      cmd: () => {
        setText(newText);
      },
      undo: () => {
        setText(savedText);
      },
      mustExec: false,
    });
    if (!newText) {
      this.remove();
      return;
    }
    this.#flushPendingMeasurement();
    this.#syncDrawLayer();
  }

  /** @inheritdoc */
  shouldGetKeyboardEvents() {
    return this.isInEditMode();
  }

  /** @inheritdoc */
  enterInEditMode(global = true) {
    this.enableEditMode(global);
    this.editorDiv.focus();
  }

  /**
   * ondblclick callback.
   * @param {MouseEvent} event
   */
  dblclick(event) {
    this.enterInEditMode(false);
  }

  /**
   * onkeydown callback.
   * @param {KeyboardEvent} event
   */
  keydown(event) {
    if (event.target === this.div && event.key === "Enter") {
      this.enterInEditMode();
      // Avoid to add an unwanted new line.
      event.preventDefault();
    }
  }

  editorDivKeydown(event) {
    FreeTextEditor._keyboardManager.exec(this, event);
  }

  editorDivFocus(event) {
    this.isEditing = true;
  }

  editorDivBlur(event) {
    this.isEditing = false;
    this.#setCompositionState(false, this.#isComposing);
  }

  editorDivInput(event) {
    this.#content = this.editorDiv.value.replaceAll(EOL_PATTERN, "\n");
    this.#scheduleMeasurement(this.#isComposing || event.isComposing);
    this.parent.div.classList.toggle("freetextEditing", this.isEmpty());
  }

  editorDivCompositionStart() {
    this.#setCompositionState(true);
  }

  editorDivCompositionEnd(event) {
    this.#setCompositionState(false, /* measure = */ true);
    this.parent.div.classList.toggle("freetextEditing", this.isEmpty());
  }

  /** @inheritdoc */
  disableEditing() {
    this.#setCompositionState(false, this.#isComposing);
    if (!this.isInEditMode()) {
      this.editorDiv.readOnly = true;
    }
  }

  /** @inheritdoc */
  enableEditing() {
    this.editorDiv.readOnly = !this.isInEditMode();
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    let baseX, baseY;
    if (this._isCopy || this.annotationElementId) {
      baseX = this.x;
      baseY = this.y;
    }

    super.render();
    if (this._isCopy || this.annotationElementId) {
      this.#hasFixedWidth = true;
      this.#hasFixedHeight = true;
    }
    this.editorDiv = document.createElement("textarea");
    this.editorDiv.className = "internal";

    this.editorDiv.setAttribute("id", this.#editorDivId);
    this.editorDiv.setAttribute("data-l10n-id", "pdfjs-free-text2");
    this.editorDiv.setAttribute("data-l10n-attrs", "default-content");
    this.editorDiv.setAttribute("aria-multiline", true);
    this.editorDiv.spellcheck = false;
    this.editorDiv.readOnly = false;

    const { style } = this.editorDiv;
    style.fontSize = `calc(${this.#fontSize}px * var(--total-scale-factor))`;
    style.color = addOpacityToColor(this.#color, this.opacity);
    // --- 设置字体样式 ---
    style.fontWeight = this.#textParams.bold ? "bold" : "normal";
    style.fontStyle = this.#textParams.italic ? "italic" : "normal";
    // eslint-disable-next-line no-nested-ternary
    style.textDecoration = this.#textParams.underline
      ? "underline"
      : this.#textParams.strikethrough
        ? "line-through"
        : "none";
    style.textAlign = this.#textParams.alignment;

    this.div.append(this.editorDiv);

    this.#measureDiv = document.createElement("div");
    this.#measureDiv.className = "freetextMeasure";
    this.#measureDiv.setAttribute("aria-hidden", true);
    this.div.append(this.#measureDiv);
    this.#setContent();

    this.overlayDiv = document.createElement("div");
    this.overlayDiv.classList.add("overlay", "enabled");
    this.div.append(this.overlayDiv);

    bindEvents(this, this.div, ["dblclick", "keydown"]);

    if (this._isCopy || this.annotationElementId) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      if (this.annotationElementId) {
        // This stuff is hard to test: if something is changed here, please
        // test with the following PDF file:
        //  - freetexts.pdf
        //  - rotated_freetexts.pdf
        // Only small variations between the original annotation and its editor
        // are allowed.

        // position is the position of the first glyph in the annotation
        // and it's relative to its container.
        const { position } = this._initialData;
        let [tx, ty] = this.getInitialTranslation();
        [tx, ty] = this.pageTranslationToScreen(tx, ty);
        const [pageWidth, pageHeight] = this.pageDimensions;
        const [pageX, pageY] = this.pageTranslation;
        let posX, posY;
        switch (this.rotation) {
          case 0:
            posX = baseX + (position[0] - pageX) / pageWidth;
            posY = baseY + this.height - (position[1] - pageY) / pageHeight;
            break;
          case 90:
            posX = baseX + (position[0] - pageX) / pageWidth;
            posY = baseY - (position[1] - pageY) / pageHeight;
            [tx, ty] = [ty, -tx];
            break;
          case 180:
            posX = baseX - this.width + (position[0] - pageX) / pageWidth;
            posY = baseY - (position[1] - pageY) / pageHeight;
            [tx, ty] = [-tx, -ty];
            break;
          case 270:
            posX =
              baseX +
              (position[0] - pageX - this.height * pageHeight) / pageWidth;
            posY =
              baseY +
              (this.width * pageWidth - position[1] + pageY) / pageHeight;
            [tx, ty] = [-ty, tx];
            break;
        }
        this.setAt(posX * parentWidth, posY * parentHeight, tx, ty);
      } else {
        this._moveAfterPaste(baseX, baseY);
      }

      this.#setContent();
      this._isDraggable = true;
      this.editorDiv.readOnly = true;
    } else {
      this._isDraggable = false;
      this.editorDiv.readOnly = false;
    }

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("TESTING")) {
      this.div.setAttribute("annotation-id", this.annotationElementId);
    }

    return this.div;
  }

  #setContent() {
    this.editorDiv.value = this.#content;
    this.#updateMeasureContent();
    this.#syncDrawLayer();
  }

  #serializeContent() {
    return this.#content;
  }

  static #deserializeContent(content) {
    return content.replaceAll(EOL_PATTERN, "\n");
  }

  /** @inheritdoc */
  get contentDiv() {
    return this.editorDiv;
  }

  get content() {
    return this.#content;
  }

  get color() {
    return this.#color;
  }

  get fontSize() {
    return this.#fontSize;
  }

  /** @inheritdoc */
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof FreeTextAnnotationElement) {
      const {
        data: {
          defaultAppearanceData: { fontSize, fontColor, opacity },
          rect,
          rotation,
          id,
          popupRef,
        },
        textContent,
        textPosition,
        parent: {
          page: { pageNumber },
        },
      } = data;
      // textContent is supposed to be an array of strings containing each line
      // of text. However, it can be null or empty.
      if (!textContent || textContent.length === 0) {
        // Empty annotation.
        return null;
      }
      initialData = data = {
        annotationType: AnnotationEditorType.FREETEXT,
        color: Array.from(fontColor),
        opacity,
        fontSize,
        value: textContent.join("\n"),
        position: textPosition,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef,
      };
    }
    const editor = await super.deserialize(data, parent, uiManager);
    editor.#fontSize = data.fontSize;
    editor.#color = Util.makeHexColor(...data.color);
    editor.#content = FreeTextEditor.#deserializeContent(data.value);
    editor.opacity = normalizeOpacity(
      data.opacity ?? FreeTextEditor._defaultOpacity,
      FreeTextEditor._defaultOpacity
    );
    editor.annotationElementId = data.id || null;
    editor._initialData = initialData;

    return editor;
  }

  /** @inheritdoc */
  serialize(isForCopying = false) {
    this.#flushPendingMeasurement();
    if (this.isEmpty()) {
      return null;
    }

    if (this.deleted) {
      return this.serializeDeleted();
    }

    const padding = FreeTextEditor._internalPadding * this.parentScale;
    const rect = this.getRect(padding, padding);
    const color = AnnotationEditor._colorManager.convert(
      this.isAttachedToDOM
        ? getComputedStyle(this.editorDiv).color
        : this.#color
    );

    const serialized = {
      annotationType: AnnotationEditorType.FREETEXT,
      color,
      opacity: normalizeOpacity(this.opacity),
      fontSize: this.#fontSize,
      value: this.#serializeContent(),
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId,
    };

    if (isForCopying) {
      // Don't add the id when copying because the pasted editor mustn't be
      // linked to an existing annotation.
      serialized.isCopy = true;
      return serialized;
    }

    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }

    serialized.id = this.annotationElementId;

    return serialized;
  }

  #hasElementChanged(serialized) {
    const { value, fontSize, color, pageIndex } = this._initialData;
    const initialOpacity = normalizeOpacity(this._initialData.opacity);

    return (
      this._hasBeenMoved ||
      this._hasBeenResized ||
      serialized.value !== value ||
      serialized.fontSize !== fontSize ||
      serialized.opacity !== initialOpacity ||
      serialized.color.some((c, i) => c !== color[i]) ||
      serialized.pageIndex !== pageIndex
    );
  }

  /** @inheritdoc */
  renderAnnotationElement(annotation) {
    const content = super.renderAnnotationElement(annotation);
    if (this.deleted) {
      return content;
    }
    const { style } = content;
    style.fontSize = `calc(${this.#fontSize}px * var(--total-scale-factor))`;
    style.color = this.#color;

    content.replaceChildren();
    for (const line of this.#content.split("\n")) {
      const div = document.createElement("div");
      div.style.fontSize = "inherit";
      div.append(
        line ? document.createTextNode(line) : document.createElement("br")
      );
      content.append(div);
    }

    const padding = FreeTextEditor._internalPadding * this.parentScale;
    annotation.updateEdited({
      rect: this.getRect(padding, padding),
      popupContent: this.#content,
    });

    return content;
  }

  resetAnnotationElement(annotation) {
    super.resetAnnotationElement(annotation);
    annotation.resetEdited();
  }
}

export { FreeTextEditor };
