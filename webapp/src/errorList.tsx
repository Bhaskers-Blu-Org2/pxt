/// <reference path="../../built/pxtlib.d.ts" />

import * as React from "react";
import * as sui from "./sui";
import { prototype } from "react-modal";

export interface ErrorListProps {
    onSizeChange?: (state: pxt.editor.ErrorListState) => void;
    listenToErrorChanges?: (key: string, onErrorChanges: (errors: pxtc.KsDiagnostic[]) => void) => void;
    listenToBlockErrorChanges?: (key: string, onErrorChanges: (errors: pxt.blocks.BlockDiagnostic[]) => void) => void;
    listenToExceptionChanges?: (handlerKey: string, handler: (exception: pxsim.DebuggerBreakpointMessage, locations: pxtc.LocationInfo[]) => void) => void,
    goToError?: (errorLocation: pxtc.LocationInfo) => void;
    startDebugger?: () => void;
}
export interface ErrorListState {
    isCollapsed: boolean,
    errors: pxtc.KsDiagnostic[],
    exception?: pxsim.DebuggerBreakpointMessage,
    callLocations?: pxtc.LocationInfo[],
    blockErrors: pxt.blocks.BlockDiagnostic[]
}

export class ErrorList extends React.Component<ErrorListProps, ErrorListState> {

    constructor(props: ErrorListProps) {
        super(props);

        this.state = {
            isCollapsed: true,
            errors: [],
            exception: null,
            blockErrors: []
        }

        this.onCollapseClick = this.onCollapseClick.bind(this)
        this.onErrorsChanged = this.onErrorsChanged.bind(this)
        this.onBlockErrorsChanged = this.onBlockErrorsChanged.bind(this)
        this.onExceptionDetected = this.onExceptionDetected.bind(this)
        this.onErrorMessageClick = this.onErrorMessageClick.bind(this)
        this.onDisplayStateChange = this.onDisplayStateChange.bind(this)
        this.getCompilerErrors = this.getCompilerErrors.bind(this)
        this.generateStackTraces = this.generateStackTraces.bind(this)
        this.listBlockErrors = this.listBlockErrors.bind(this)

        if (props.listenToBlockErrorChanges) {
            props.listenToBlockErrorChanges("errorList", this.onBlockErrorsChanged)
        }

        // used for monaco errors TEMP
        if (props.listenToErrorChanges && props.listenToExceptionChanges) {
            props.listenToErrorChanges("errorList", this.onErrorsChanged);
            props.listenToExceptionChanges("errorList", this.onExceptionDetected);
        }
    }

    render() {
        const {isCollapsed, errors, exception, blockErrors} = this.state;
        const errorsAvailable = true; //!!errors?.length || !!exception; TEMP
        const collapseTooltip = lf("Collapse Error List");

        //const errorListContent = !isCollapsed ? (exception ? this.generateStackTraces(exception) : this.getCompilerErrors(errors)) : undefined;
        const errorListContent = blockErrors ? this.listBlockErrors(blockErrors) : undefined;

        return (
            <div className={`errorList ${isCollapsed ? 'errorListSummary' : ''}`} hidden={!errorsAvailable}>
                <div className="errorListHeader" role="button" aria-label={lf("{0} error list", isCollapsed ? lf("Expand") : lf("Collapse"))} onClick={this.onCollapseClick} onKeyDown={sui.fireClickOnEnter} tabIndex={0}>
                    <h4>{lf("Problems")}</h4>
                    <div className="ui red circular label countBubble">{exception ? 1 : errors.length}</div>
                    <div className="toggleButton"><sui.Icon icon={`chevron ${isCollapsed ? 'up' : 'down'}`}/></div>
                </div>
                {!isCollapsed && <div className="errorListInner">
                    {exception && <div className="debuggerSuggestion" role="button" onClick={this.props.startDebugger} onKeyDown={sui.fireClickOnEnter} tabIndex={0}>
                        {lf("Debug this project")}
                        <sui.Icon className="debug-icon" icon="icon bug"/>
                    </div>}
                    {errorListContent}
                </div>}
            </div>
        )
    }

    onDisplayStateChange() {
        const { errors, exception, isCollapsed } = this.state;
        // notify parent on possible size change so siblings (monaco)
        // can resize if needed

        const noValueToDisplay = !(errors?.length || exception);

        // TEMP
        if (this.props.onSizeChange) {
            this.props.onSizeChange(
                noValueToDisplay ?
                    undefined
                    : isCollapsed ?
                        pxt.editor.ErrorListState.HeaderOnly
                        : pxt.editor.ErrorListState.Expanded
            );
        }
    }

    onCollapseClick() {
        pxt.tickEvent('errorlist.collapse', null, { interactiveConsent: true })
        this.setState({
            isCollapsed: !this.state.isCollapsed
        }, this.onDisplayStateChange);
    }

    onErrorMessageClick(e: pxtc.LocationInfo, index: number) {
        pxt.tickEvent('errorlist.goto', {errorIndex: index}, { interactiveConsent: true });
        this.props.goToError(e)
    }

    onErrorsChanged(errors: pxtc.KsDiagnostic[]) {
        this.setState({
            errors,
            isCollapsed: errors?.length == 0 || this.state.isCollapsed,
            exception: null
        }, this.onDisplayStateChange);
    }

    onBlockErrorsChanged(blockErrors: pxt.blocks.BlockDiagnostic[]) {
        this.setState({
            blockErrors,
            isCollapsed: blockErrors?.length == 0 || this.state.isCollapsed,
            exception: null
        }, this.onDisplayStateChange);
    }

    onExceptionDetected(exception: pxsim.DebuggerBreakpointMessage, callLocations: pxtc.LocationInfo[]) {
        this.setState({
            exception,
            callLocations
        })
    }



    getCompilerErrors(errors: pxtc.KsDiagnostic[]) {
        function errorKey(error: pxtc.KsDiagnostic): string {
            // React likes have a "key" for each element so that it can smartly only
            // re-render what changes. Think of it like a hashcode/
            return `${error.messageText}-${error.fileName}-${error.line}-${error.column}`
        }

        return <div className="ui selection list">
            {(errors).map((e, index) => <ErrorListItem key={errorKey(e)} index={index} error={e} revealError={this.onErrorMessageClick} />)}
        </div>
    }

    generateStackTraces(exception: pxsim.DebuggerBreakpointMessage) {
        return <div>
            <div className="exceptionMessage">{pxt.Util.rlf(exception.exceptionMessage)}</div>
            <div className="ui selection list">
                {(exception.stackframes || []).map((sf, index) => {
                    const location = this.state.callLocations[sf.callLocationId];

                    if (!location) return null;

                    return <ErrorListItem key={index} index={index} stackframe={sf} location={location} revealError={this.onErrorMessageClick}/>
                })}
            </div>
        </div>;
    }

    listBlockErrors(blockErrors: pxt.blocks.BlockDiagnostic[]) {
        return <div className="ui selection list">
            {(blockErrors || []).map((e, i) => <ErrorListItem key={`${i}-${e}`} blockError={e}/>)}
        </div>
    }
}

interface ErrorListItemProps {
    index?: number;
    revealError?: (location: pxtc.LocationInfo, index: number) => void;
    error?: pxtc.KsDiagnostic;
    stackframe?: pxsim.StackFrameInfo;
    location?: pxtc.LocationInfo;
    blockError?: pxt.blocks.BlockDiagnostic;
}

interface ErrorListItemState {
}


class ErrorListItem extends React.Component<ErrorListItemProps, ErrorListItemState> {
    constructor(props: ErrorListItemProps) {
        super(props)

        this.onErrorListItemClick = this.onErrorListItemClick.bind(this)
    }

    render() {
        const {error, stackframe, location, blockError} = this.props

        // const message = stackframe ? lf("at {0} (line {1})", stackframe.funcInfo.functionName, location.line + 1)
        //     : lf("Line {0}: {1}", error.endLine ? error.endLine + 1 : error.line + 1, error.messageText)

        const message = blockError ? lf("{0}", blockError.message) : undefined

        return <div className={`item ${stackframe ? 'stackframe' : ''}`} role="button"
                    onClick={this.onErrorListItemClick}
                    onKeyDown={sui.fireClickOnEnter}
                    aria-label={lf("Go to {0}: {1}", stackframe ? '' : 'error', message)}
                    tabIndex={0}>
            {message}
        </div>
    }

    onErrorListItemClick() {
        const location = this.props.stackframe ? this.props.location : this.props.error
        this.props.revealError(location, this.props.index)
    }
}
