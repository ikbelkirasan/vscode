/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as platform from 'vs/base/common/platform';
import windowsProcessTree = require('windows-process-tree');
import { TPromise } from 'vs/base/common/winjs.base';
import { Emitter, debounceEvent } from 'vs/base/common/event';
import { ITerminalInstance } from 'vs/workbench/parts/terminal/common/terminal';
import { Terminal as XTermTerminal } from 'xterm';

const SHELL_EXECUTABLES = ['cmd.exe', 'powershell.exe', 'bash.exe'];

export class WindowsShellHelper {
	private _childProcessIdStack: number[];
	private _onCheckShell: Emitter<TPromise<string>>;
	private _wmicProcess: cp.ChildProcess;
	private _isDisposed: boolean;
	private _shellName: string;
	private _programName: string;

	public constructor(
		private _rootProcessId: number,
		private _rootShellExecutable: string,
		private _terminalInstance: ITerminalInstance,
		private _xterm: XTermTerminal
	) {
		if (!platform.isWindows) {
			throw new Error(`WindowsShellHelper cannot be instantiated on ${platform.platform}`);
		}

		this._childProcessIdStack = [this._rootProcessId];
		this._isDisposed = false;
		this._onCheckShell = new Emitter<TPromise<string>>();
		// The debounce is necessary to prevent multiple processes from spawning when
		// the enter key or output is spammed
		debounceEvent(this._onCheckShell.event, (l, e) => e, 150, true)(() => {
			setTimeout(() => {
				this.checkShell();
			}, 50);
		});

		this._xterm.on('lineFeed', () => this._onCheckShell.fire());
		this._xterm.on('keypress', () => this._onCheckShell.fire());
	}

	private checkShell(): void {
		if (platform.isWindows && this._terminalInstance.isTitleSetByProcess) {
			this.updateProgramName().then(title => {
				if (!this._isDisposed) {
					this._terminalInstance.setTitle(this._programName, true);
				}
			});
		}
	}

	private traverseTree(tree: any): string {
		if (SHELL_EXECUTABLES.indexOf(tree.name) === -1) {
			return tree.name;
		}
		this._shellName = tree.name;
		if (!tree.children || tree.children.length === 0) {
			return tree.name;
		}
		let favouriteChild = 0;
		for (; favouriteChild < tree.children.length; favouriteChild++) {
			const child = tree.children[favouriteChild];
			if (!child.children || child.children.length === 0) {
				break;
			}
			if (child.children[0].name !== 'conhost.exe') {
				break;
			}
		}
		if (favouriteChild >= tree.children.length) {
			return tree.name;
		}
		return this.traverseTree(tree.children[favouriteChild]);
	}

	public dispose(): void {
		this._isDisposed = true;
		if (this._wmicProcess) {
			this._wmicProcess.kill();
		}
	}

	/**
	 * Updates innermost shell executable and innermost shell running in the terminal
	 */
	public updateProgramName(): TPromise<void> {
		return new TPromise<void>(resolve => {
			windowsProcessTree(this._rootProcessId, (tree) => {
				this._programName = this.traverseTree(tree);
				resolve(null);
			});
		});
	}

	/**
	 * Returns the innermost program executable running in the terminal
	 */
	public getProgramName(): string {
		return this._programName;
	}

	/**
	 * Returns the innermost shell executable running in the terminal
	 */
	public getShellName(): string {
		return this._shellName;
	}

}
