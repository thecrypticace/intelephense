/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TreeVisitor } from './types';
import {
    Phrase, Token, PhraseType, TokenType,
    QualifiedName
} from 'php7parser';
import { SymbolKind, PhpSymbol } from './symbol';
import { SymbolStore } from './symbolStore';
import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { Predicate } from './types';
import * as lsp from 'vscode-languageserver-types';

/**
 * Collects 
 */
export class ReferenceVisitor implements TreeVisitor<Phrase | Token> {

    private _references: Reference[];

    constructor(
        public doc: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore
    ) {
        this._references = [];
    }

    get references() {
        return this._references;
    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.FullyQualifiedName:
                this._qualifiedName(<QualifiedName>node, parent);
                break;

            case PhraseType.NamespaceName:
                if (
                    parent.phraseType === PhraseType.QualifiedName ||
                    parent.phraseType === PhraseType.RelativeQualifiedName ||
                    parent.phraseType === PhraseType.FullyQualifiedName
                ) {
                    break;
                }

                break;

            case PhraseType.PropertyAccessExpression:

                break;

            case PhraseType.MethodCallExpression:

                break;

            case PhraseType.ScopedMemberName:

                break;
                
            default:

                break;

        }


    }

    private _qualifiedName(node: QualifiedName, parent: Phrase) {
        let kind = SymbolKind.Class;
        if (parent.phraseType === PhraseType.ConstantAccessExpression) {
            kind = SymbolKind.Constant;
        } else if (parent.phraseType === PhraseType.FunctionCallExpression) {
            kind = SymbolKind.Function;
        }

        let ref: Reference = {
            range: this.doc.nodeRange(node),
            symbol: null
        };

        let text = this.doc.nodeText(node.name, [TokenType.Whitespace, TokenType.Comment]);

        if (
            node.phraseType === PhraseType.QualifiedName &&
            text.indexOf('\\') < 0 &&
            (ref.symbol = this.nameResolver.matchImportedSymbol(text, kind))
        ) {
            //reference the import rule
            return ref;
        }

        //reference the actual symbol 
        if (node.phraseType === PhraseType.QualifiedName) {
            text = this.nameResolver.resolveNotFullyQualified(text, kind);
        } else if (node.phraseType === PhraseType.RelativeQualifiedName) {
            text = this.nameResolver.resolveRelative(text);
        }

        let pred: Predicate<PhpSymbol> = (x) => {
            return x.kind === kind;
        };
        ref.symbol = this.symbolStore.find(text, pred);

        if (ref.symbol) {
            this._references.push(ref);
            return ref;
        }

        return null;

    }


}


export interface Reference {
    range: lsp.Range;
    symbol: PhpSymbol;
}

export class DocumentReferences {

    private _references: Reference[];
    private _uri: string;

    constructor(uri: string, references: Reference[]) {
        this._uri
        this._references = [];
    }

    add(ref: Reference) {
        this._references.push(ref);
    }

    match(predicate: Predicate<Reference>) {
        let matches: Reference[] = [];
        let ref: Reference;
        for (let n = 0, l = this._references.length; n < l; ++n) {
            ref = this._references[n];
            if (predicate(ref)) {
                matches.push(ref);
            }
        }
        return matches;
    }

}