/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TypeString } from './typeString';
import { BinarySearch } from './types';
import { Location, Range } from 'vscode-languageserver-types';
import * as util from './util';

export const enum SymbolKind {
    None = 0,
    Class = 1 << 0,
    Interface = 1 << 1,
    Trait = 1 << 2,
    Constant = 1 << 3,
    Property = 1 << 4,
    Method = 1 << 5,
    Function = 1 << 6,
    Parameter = 1 << 7,
    Variable = 1 << 8,
    Namespace = 1 << 9,
    ClassConstant = 1 << 10,
    Constructor = 1 << 11
}

export const enum SymbolModifier {
    None = 0,
    Public = 1 << 0,
    Protected = 1 << 1,
    Private = 1 << 2,
    Final = 1 << 3,
    Abstract = 1 << 4,
    Static = 1 << 5,
    ReadOnly = 1 << 6,
    WriteOnly = 1 << 7,
    Magic = 1 << 8,
    Anonymous = 1 << 9,
    Reference = 1 << 10,
    Variadic = 1 << 11,
    Use = 1 << 12
}

export interface PhpSymbolDoc {
    description?: string;
    type?: string;
}

export namespace PhpSymbolDoc {
    export function create(description?: string, type?: string): PhpSymbolDoc {
        return {
            description: description || '',
            type: type || ''
        };
    }
}

export interface PhpSymbol extends SymbolIdentifier {
    modifiers?: SymbolModifier;
    doc?: PhpSymbolDoc;
    type?: string;
    associated?: PhpSymbol[];
    children?: PhpSymbol[];
    value?: string;
    references?:Reference[];
}

export interface SymbolIdentifier {
    kind:SymbolKind;
    name:string;
    scope?:string;
    location?:HashedLocation;
}

export interface HashedLocation {
    uriHash: number;
    range:Range;
}

export namespace PhpSymbol {

    function isParameter(s: PhpSymbol) {
        return s.kind === SymbolKind.Parameter;
    }

    export function signatureString(s: PhpSymbol) {

        if (!s || !(s.kind & (SymbolKind.Function | SymbolKind.Method))) {
            return '';
        }

        let params = s.children ? s.children.filter(isParameter) : [];
        let paramStrings: String[] = [];
        let param: PhpSymbol;
        let parts: string[];
        let paramType: string;

        for (let n = 0, l = params.length; n < l; ++n) {
            param = params[n];
            parts = [];

            if (n) {
                parts.push(',');
            }

            paramType = PhpSymbol.type(param);
            if (paramType) {
                parts.push(paramType);
            }

            parts.push(param.name);

            if (param.value) {
                paramStrings.push(`[${parts.join(' ')}]`);
            } else {
                paramStrings.push(parts.join(' '));
            }

        }

        let sig = `(${paramStrings.join('')})`;
        let sType = PhpSymbol.type(s);
        if (sType) {
            sig += `: ${sType}`;
        }
        return sig;

    }

    export function hasParameters(s: PhpSymbol) {
        return s.children && s.children.find(isParameter) !== undefined;
    }

    export function notFqn(text: string) {
        if (!text) {
            return text;
        }
        let pos = text.lastIndexOf('\\') + 1;
        return text.slice(pos);
    }

    /**
     * Shallow clone
     * @param s 
     */
    export function clone(s: PhpSymbol): PhpSymbol {
        return {
            kind: s.kind,
            name: s.name,
            children: s.children,
            location: s.location,
            modifiers: s.modifiers,
            associated: s.associated,
            type: s.type,
            doc: s.doc,
            scope: s.scope,
            value: s.value
        };
    }

    export function type(s: PhpSymbol) {
        if (s.type) {
            return s.type;
        } else if (s.doc && s.doc.type) {
            return s.doc.type;
        } else {
            return '';
        }

    }

    export function setScope(symbols: PhpSymbol[], scope: string) {
        if (!symbols) {
            return symbols;
        }
        for (let n = 0; n < symbols.length; ++n) {
            symbols[n].scope = scope;
        }
        return symbols;
    }

    export function create(kind: SymbolKind, name: string, location?: HashedLocation): PhpSymbol {
        return {
            kind: kind,
            name: name,
            location: location
        };
    }

}

export interface Reference extends SymbolIdentifier {
    type?: string;
    altName?: string;
}

export namespace Reference {
    export function create(kind: SymbolKind, name: string, location: HashedLocation) : Reference {
        return {
            kind: kind,
            name: name,
            location: location
        };
    }
}
