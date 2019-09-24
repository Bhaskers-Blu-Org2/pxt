import * as React from 'react';
import { connect } from 'react-redux';

import { ImageEditorStore, ImageEditorTool } from './store/imageReducer';
import { dispatchImageEdit, dispatchChangeZoom } from "./actions/dispatch";
import { ImageState, Bitmap } from './store/bitmap';
import { GestureTarget, ClientCoordinates, bindGestureEvents } from './util';

import { Edit, EditState, getEdit, getEditState, ToolCursor, tools } from './toolDefinitions';

export interface ImageCanvasProps {
    dispatchImageEdit: (state: ImageState) => void;
    dispatchChangeZoom: (zoom: number) => void;
    selectedColor: number;
    backgroundColor: number;
    tool: ImageEditorTool;
    toolWidth: number;
    zoomDelta: number;
    onionSkinEnabled: boolean;

    colors: string[];
    imageState: ImageState;
    prevFrame?: ImageState;
}

class ImageCanvasImpl extends React.Component<ImageCanvasProps, {}> implements GestureTarget {
    protected canvas: HTMLCanvasElement;
    protected background: HTMLCanvasElement;
    protected floatingLayer: HTMLDivElement;

    protected edit: Edit;
    protected editState: EditState;
    protected cursorLocation: [number, number];
    protected cursor: ToolCursor | string = ToolCursor.Crosshair;
    protected zoom = 0.25;
    protected panX = 0;
    protected panY = 0;

    protected lastPanX: number;
    protected lastPanY: number;

    render() {
        const { imageState } = this.props;
        const isPortrait = !imageState || (imageState.bitmap.height > imageState.bitmap.width);

        return <div ref="canvas-bounds" className={`image-editor-canvas ${isPortrait ? "portrait" : "landscape"}`} onContextMenu={ev => ev.preventDefault()}>
            <div className="paint-container">
                <canvas ref="paint-surface-bg" className="paint-surface" />
                <canvas ref="paint-surface" className="paint-surface" />
                <div ref="floating-layer-border" className="image-editor-floating-layer" />
            </div>
        </div>
    }

    componentDidMount() {
        this.canvas = this.refs["paint-surface"] as HTMLCanvasElement;
        this.background = this.refs["paint-surface-bg"] as HTMLCanvasElement;
        this.floatingLayer = this.refs["floating-layer-border"] as HTMLDivElement;
        bindGestureEvents(this.refs["canvas-bounds"] as HTMLDivElement, this);
        // bindGestureEvents(this.floatingLayer, this);

        (this.refs["canvas-bounds"] as HTMLDivElement).addEventListener("wheel", ev => {
            this.updateZoom(ev.deltaY / 30, ev.clientX, ev.clientY);
            ev.preventDefault();
        });

        (this.refs["canvas-bounds"] as HTMLDivElement).addEventListener("mousemove", ev => {
            if (!this.edit) this.updateCursorLocation(ev);
        });

        const { imageState } = this.props;
        this.editState = getEditState(imageState);

        this.redraw();
        this.updateBackground();
    }

    componentDidUpdate() {
        if (!this.edit || !this.editState) {
            const { imageState } = this.props;
            this.editState = getEditState(imageState);
        }

        if (this.props.zoomDelta) {
            // This is a total hack. Ideally, the zoom should be part of the global state but because
            // the mousewheel events fire very quickly it's much more performant to make it local state.
            // So, for buttons outside this component to change the zoom they have to set the zoom delta
            // which is applied here and then set back to zero
            this.zoom = Math.max(this.zoom + this.props.zoomDelta, 0.5);
            this.updateZoom(this.props.zoomDelta)
            this.props.dispatchChangeZoom(0);
            return;
        }

        this.redraw();
        this.updateBackground();
    }

    onClick(coord: ClientCoordinates, isRightClick?: boolean): void {
        if (this.isPanning()) return;

        this.updateCursorLocation(coord);

        if (!this.inBounds(this.cursorLocation[0], this.cursorLocation[1])) return;

        this.startEdit(!!isRightClick);
        this.updateEdit(this.cursorLocation[0], this.cursorLocation[1]);
        this.commitEdit();
    }

    onDragStart(coord: ClientCoordinates, isRightClick?: boolean): void {
        if (this.isPanning()) {
            this.lastPanX = coord.clientX;
            this.lastPanY = coord.clientY;
            this.updateCursor(true, false);
        }
        else {
            this.updateCursorLocation(coord);
            this.startEdit(!!isRightClick);
        }
    }

    onDragMove(coord: ClientCoordinates): void {
        if (this.isPanning()) {
            this.panX += this.lastPanX - coord.clientX;
            this.panY += this.lastPanY - coord.clientY;
            this.lastPanX = coord.clientX;
            this.lastPanY = coord.clientY;

            this.updateCursor(true, false);
        }
        else if (!this.edit) return;
        else if (this.updateCursorLocation(coord)) {
            this.updateEdit(this.cursorLocation[0], this.cursorLocation[1]);
        }
    }

    onDragEnd(coord: ClientCoordinates): void {
        if (this.isPanning()) {
            this.panX += this.lastPanX - coord.clientX;
            this.panY += this.lastPanY - coord.clientY;
            this.lastPanX = undefined;
            this.lastPanY = undefined;

            this.updateCursor(false, false);
        }
        else {
            if (!this.edit) return;
            if (this.updateCursorLocation(coord))
                this.updateEdit(this.cursorLocation[0], this.cursorLocation[1]);

            this.edit.end(this.cursorLocation[0], this.cursorLocation[1], this.editState);
            this.commitEdit();
        }
    }

    protected updateCursorLocation(coord: ClientCoordinates): boolean {
        if (this.canvas) {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.floor(((coord.clientX - rect.left) / rect.width) * this.canvas.width);
            const y = Math.floor(((coord.clientY - rect.top) / rect.height) * this.canvas.height);

            if (!this.cursorLocation || x !== this.cursorLocation[0] || y !== this.cursorLocation[1]) {
                this.cursorLocation = [x, y];

                this.updateCursor(!!this.edit, this.editState.inFloatingLayer(x, y));
                return true;
            }

            return false;
        }

        this.cursorLocation = [0, 0];
        return false;
    }

    protected updateCursor(isDown: boolean, inLayer: boolean) {
        const { tool } = this.props;
        const def = tools.filter(td => td.tool === tool)[0];

        if (!def) this.updateCursorCore(ToolCursor.Default)
        else if (inLayer) {
            if (isDown) {
                this.updateCursorCore(def.downLayerCursr || def.hoverLayerCursor || def.downCursor || def.hoverCursor);
            }
            else {
                this.updateCursorCore(def.hoverLayerCursor || def.hoverCursor);
            }
        }
        else if (isDown) {
            this.updateCursorCore(def.downCursor || def.hoverCursor);
        }
        else {
            this.updateCursorCore(def.hoverCursor);
        }
    }

    protected updateCursorCore(cursor: ToolCursor | string) {
        this.cursor = cursor || ToolCursor.Default;

        this.updateBackground();
    }

    protected startEdit(isRightClick: boolean) {
        const { tool, toolWidth, selectedColor, backgroundColor } = this.props;

        const [x, y] = this.cursorLocation;

        if (this.inBounds(x, y)) {
            this.edit = getEdit(tool, this.editState, isRightClick ? backgroundColor : selectedColor, toolWidth);
            this.edit.start(this.cursorLocation[0], this.cursorLocation[1], this.editState);
        }
    }

    protected updateEdit(x: number, y: number) {
        if (this.edit && this.inBounds(x, y)) {
            this.edit.update(x, y);

            this.redraw();
        }
    }

    protected commitEdit() {
        const { dispatchImageEdit, imageState } = this.props;

        if (this.edit) {
            this.editState = getEditState(imageState);
            this.edit.doEdit(this.editState);
            this.edit = undefined;

            dispatchImageEdit({
                bitmap: this.editState.image.data(),
                layerOffsetX: this.editState.layerOffsetX,
                layerOffsetY: this.editState.layerOffsetY,
                floatingLayer: this.editState.floatingLayer && this.editState.floatingLayer.data()
            });

        }
    }

    protected redraw() {
        const { imageState, prevFrame: nextFrame, onionSkinEnabled } = this.props;

        if (this.canvas) {
            this.canvas.width = imageState.bitmap.width;
            this.canvas.height = imageState.bitmap.height;

            if (onionSkinEnabled && nextFrame) {
                const next = getEditState(nextFrame);
                const context = this.canvas.getContext("2d");

                context.globalAlpha = 0.5;

                this.drawBitmap(next.image);
                if (next.floatingLayer) {
                    this.drawBitmap(next.floatingLayer, next.layerOffsetX, next.layerOffsetY, true);
                }

                context.globalAlpha = 1;
            }

            if (this.edit) {
                const clone = this.editState.copy();
                this.edit.doEdit(clone);
                this.drawBitmap(clone.image);
                this.redrawFloatingLayer(clone);
            }
            else {
                this.drawBitmap(this.editState.image);
                this.redrawFloatingLayer(this.editState);
            }

            // Only redraw checkerboard if the image size has changed
            if (this.background.width != this.canvas.width << 1 || this.background.height != this.canvas.height << 1) {
                this.background.width = this.canvas.width << 1;
                this.background.height = this.canvas.height << 1;

                const ctx = this.background.getContext("2d");
                ctx.imageSmoothingEnabled = false;
                ctx.fillStyle = "#aeaeae";
                ctx.fillRect(0, 0, this.background.width, this.background.height);

                ctx.fillStyle = "#dedede";
                for (let x = 0; x < this.background.width; x++) {
                    for (let y = 0; y < this.background.height; y++) {
                        if ((x + y) & 1) {
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                }
            }

        }
    }

    protected redrawFloatingLayer(state: EditState) {
        const floatingRect = this.refs["floating-layer-border"] as HTMLDivElement;
        if (state.floatingLayer) {
            this.drawBitmap(state.floatingLayer, state.layerOffsetX, state.layerOffsetY, true);

            const rect = this.canvas.getBoundingClientRect();

            const left = Math.max(state.layerOffsetX, 0)
            const top = Math.max(state.layerOffsetY, 0)
            const right = Math.min(state.layerOffsetX + state.floatingLayer.width, state.width);
            const bottom = Math.min(state.layerOffsetY + state.floatingLayer.height, state.height);

            const xScale = rect.width / state.width;
            const yScale = rect.height / state.height;

            floatingRect.style.display = ""

            floatingRect.style.left = (rect.left - 2 + xScale * left) + "px";
            floatingRect.style.top = (rect.top - 2 + yScale * top) + "px";
            floatingRect.style.width = (xScale * (right - left)) + "px";
            floatingRect.style.height = (yScale * (bottom - top)) + "px";

            floatingRect.style.borderLeft = left >= 0 ? "" : "none";
            floatingRect.style.borderTop = top >= 0 ? "" : "none";
            floatingRect.style.borderRight = right < state.width ? "" : "none";
            floatingRect.style.borderBottom = bottom < state.height ? "" : "none";
        }
        else {
            floatingRect.style.display = "none"
        }
    }

    protected drawBitmap(bitmap: Bitmap, x0 = 0, y0 = 0, transparent = true) {
        const { colors } = this.props;

        const context = this.canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        for (let x = 0; x < bitmap.width; x++) {
            for (let y = 0; y < bitmap.height; y++) {
                const index = bitmap.get(x, y);

                if (index) {
                    context.fillStyle = colors[index];
                    context.fillRect(x + x0, y + y0, 1, 1);
                }
                else {
                    if (!transparent) context.clearRect(x + x0, y + y0, 1, 1);
                }
            }
        }
    }

    protected updateBackground() {
        (this.refs["canvas-bounds"] as HTMLDivElement).style.cursor = this.cursor;
        this.canvas.style.cursor = this.cursor;
        this.updateZoom(0);
    }

    protected updateZoom(delta: number, anchorX?: number, anchorY?: number) {
        const outer = this.refs["canvas-bounds"] as HTMLDivElement;
        if (this.canvas && outer) {
            const bounds = outer.getBoundingClientRect();

            anchorX = anchorX === undefined ? bounds.left + (bounds.width >> 1) : anchorX;
            anchorY = anchorY === undefined ? bounds.top + (bounds.height >> 1) : anchorY;

            const { canvasX: oldX, canvasY: oldY } = this.clientToCanvas(anchorX, anchorY, bounds);

            this.zoom = Math.max(this.zoom + delta, 0.25);

            const unit = this.getCanvasUnit(bounds);
            const newWidth = unit * this.canvas.width;
            const newHeight = unit * this.canvas.height;

            // Center if smaller than bounds, otherwise adjust the pan so that the zoom is anchored at the cursor
            const { canvasX, canvasY } = this.clientToCanvas(anchorX, anchorY, bounds);

            if (newWidth < bounds.width) {
                this.panX = -((bounds.width >> 1) - (newWidth >> 1));
            }
            else {
                this.panX += (oldX - canvasX) * unit;
            }

            if (newHeight < bounds.height) {
                this.panY = -((bounds.height >> 1) - (newHeight >> 1));
            }
            else {
                this.panY += (oldY - canvasY) * unit;
            }

            this.applyZoom();
        }
    }

    protected applyZoom(bounds?: ClientRect) {
        const outer = this.refs["canvas-bounds"] as HTMLDivElement;
        if (this.canvas && outer) {
            bounds = bounds || outer.getBoundingClientRect();

            const unit = this.getCanvasUnit(bounds);
            const newWidth = unit * this.canvas.width;
            const newHeight = unit * this.canvas.height;

            this.canvas.style.position = "fixed"
            this.canvas.style.width = `${newWidth}px`;
            this.canvas.style.height = `${newHeight}px`;
            this.canvas.style.left = `${-this.panX}px`
            this.canvas.style.top = `${-this.panY}px`

            this.canvas.style.clipPath =  `polygon(${this.panX}px ${this.panY}px, ${this.panX + bounds.width}px ${this.panY}px, ${this.panX + bounds.width}px ${this.panY + bounds.height}px, ${this.panX}px ${this.panY + bounds.height}px)`;
            // this.canvas.style.imageRendering = "pixelated"

            this.background.style.position = this.canvas.style.position;
            this.background.style.width = this.canvas.style.width;
            this.background.style.height = this.canvas.style.height;
            this.background.style.left = this.canvas.style.left;
            this.background.style.top = this.canvas.style.top;
            this.background.style.clipPath =  `polygon(${this.panX}px ${this.panY}px, ${this.panX + bounds.width}px ${this.panY}px, ${this.panX + bounds.width}px ${this.panY + bounds.height}px, ${this.panX}px ${this.panY + bounds.height}px)`;

            this.redrawFloatingLayer(this.editState);
        }
    }

    protected clientToCanvas(clientX: number, clientY: number, bounds: ClientRect) {
        const unit = this.getCanvasUnit(bounds);

        return {
            canvasX: ((clientX - bounds.left + this.panX) / unit),
            canvasY: ((clientY - bounds.top + this.panY) / unit)
        }
    }

    /**
     * Gets the pixel side-length for canvas to fit in the bounds at a zoom of 1
     * @param bounds The bounds in which the canvas is contained
     */
    protected getCanvasUnit(bounds: ClientRect) {
        return this.zoom * (this.canvas.height > this.canvas.width ? bounds.height / this.canvas.height : bounds.width / this.canvas.width);
    }

    protected inBounds(x: number, y: number) {
        return x >= 0 && x < this.canvas.width && y >= 0 && y < this.canvas.height;
    }

    protected isPanning() {
        return this.props.tool === ImageEditorTool.Pan;
    }
}


function mapStateToProps({ present: state, editor }: ImageEditorStore, ownProps: any) {
    if (!state) return {};
    return {
        selectedColor: editor.selectedColor,
        colors: state.colors,
        imageState: state.frames[state.currentFrame],
        tool: editor.tool,
        toolWidth: editor.cursorSize,
        zoomDelta: editor.zoomDelta,
        onionSkinEnabled: editor.onionSkinEnabled,
        backgroundColor: editor.backgroundColor,
        prevFrame: state.frames[state.currentFrame - 1]
    };
}

const mapDispatchToProps = {
    dispatchImageEdit,
    dispatchChangeZoom
};

export const ImageCanvas = connect(mapStateToProps, mapDispatchToProps)(ImageCanvasImpl);