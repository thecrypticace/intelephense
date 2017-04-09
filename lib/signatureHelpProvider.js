/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const context_1 = require("./context");
const parsedDocument_1 = require("./parsedDocument");
class SignatureHelpProvider {
    constructor(symbolStore, docStore) {
        this.symbolStore = symbolStore;
        this.docStore = docStore;
    }
    provideSignatureHelp(uri, position) {
        let doc = this.docStore.find(uri);
        if (!doc) {
            return null;
        }
        let context = new context_1.Context(this.symbolStore, doc, position);
        let traverser = context.createTraverser();
        let callableExpr = traverser.ancestor(this._isCallablePhrase);
        if (!callableExpr) {
            return null;
        }
        let symbol = this._getSymbol(callableExpr, context);
        let argNumber = this._getArgumentNumber(callableExpr.children.find((x) => {
            return parsedDocument_1.ParsedDocument.isPhrase(x, [8 /* ArgumentExpressionList */]);
        }), context);
    }
    _createSignatureHelp(s, argNumber) {
        let params = s.children.filter((x) => {
            return x.kind === 128 /* Parameter */;
        });
        if (!params.length) {
            return null;
        }
        let nOptionalParams = params.reduce((carry, value) => {
            return value.value ? carry + 1 : carry;
        }, 0);
        let nRequiredParams = params.length - nOptionalParams;
        let signatures = [];
        if (nRequiredParams > 0) {
            signatures.push(this._signatureInfo(s, params.slice(0, nRequiredParams)));
        }
        for (let n = 1; n <= nOptionalParams; ++n) {
            signatures.push(this._signatureInfo(s, params.slice(0, nRequiredParams + n)));
        }
        let activeSig = signatures.findIndex((v) => {
            return v.parameters.length > argNumber;
        });
        return {
            activeParameter: argNumber,
            activeSignature: activeSig,
            signatures: signatures
        };
    }
    _signatureInfo(fn, params) {
        let paramInfoArray = this._parameterInfoArray(params);
        let label = fn.name + '(';
        label += paramInfoArray.map((v) => {
            return v.label;
        }).join(', ');
        label += ')';
        if (fn.type && !fn.type.isEmpty()) {
            label += ': ' + fn.type.toString();
        }
        return {
            label: label,
            documentation: fn.description
        };
    }
    _parameterInfoArray(params) {
        let infos = [];
        for (let n = 0, l = params.length; n < l; ++n) {
            infos.push(this._parameterInfo(params[n]));
        }
        return infos;
    }
    _parameterInfo(s) {
        let labelParts = [];
        if (s.type && !s.type.isEmpty()) {
            labelParts.push(s.type.toString());
        }
        labelParts.push(s.name);
        if (s.value) {
            labelParts.push('= ' + s.value);
        }
        return {
            label: labelParts.join(' '),
            documentation: s.description
        };
    }
    _getSymbol(callableExpr, context) {
        switch (callableExpr.phraseType) {
            case 84 /* FunctionCallExpression */:
                return this._functionCallExpressionSymbol(callableExpr, context);
            case 110 /* MethodCallExpression */:
                return this._methodCallExpressionSymbol(callableExpr, context);
            case 148 /* ScopedCallExpression */:
                return this._scopedCallExpressionSymbol(callableExpr, context);
            case 126 /* ObjectCreationExpression */:
                return this._objectCreationExpressionSymbol(callableExpr, context);
            default:
                throw new Error('Invalid Argument');
        }
    }
    _functionCallExpressionSymbol(phrase, context) {
        let fqn = context.resolveFqn(phrase.callableExpr, 64 /* Function */);
        return this.symbolStore.find(fqn, (x) => {
            return x.kind === 64 /* Function */;
        });
    }
    _methodCallExpressionSymbol(phrase, context) {
        let typeNames = context.resolveExpressionType(phrase.variable).atomicClassArray();
        let memberName = parsedDocument_1.ParsedDocument.isFixedMemberName(phrase.memberName) ?
            context.nodeText(phrase.memberName) : '';
        if (!typeNames.length || !memberName) {
            return null;
        }
        let queries = [];
        let pred = (x) => {
            return x.kind === 32 /* Method */ &&
                !(x.modifiers & 32 /* Static */) &&
                x.name === memberName;
        };
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            queries.push({
                typeName: typeNames[n],
                memberPredicate: pred
            });
        }
        return this.symbolStore.lookupMembersOnTypes(queries).shift();
    }
    _scopedCallExpressionSymbol(phrase, context) {
        let typeNames = context.resolveExpressionType(phrase.scope).atomicClassArray();
        let memberName = parsedDocument_1.ParsedDocument.isFixedScopedMemberName(phrase.memberName) ?
            context.nodeText(phrase.memberName) : '';
        if (!typeNames.length || !memberName) {
            return null;
        }
        let queries = [];
        let pred = (x) => {
            return x.kind === 32 /* Method */ &&
                (x.modifiers & 32 /* Static */) > 0 &&
                x.name === memberName;
        };
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            queries.push({
                typeName: typeNames[n],
                memberPredicate: pred
            });
        }
        return this.symbolStore.lookupMembersOnTypes(queries).shift();
    }
    _objectCreationExpressionSymbol(phrase, context) {
        let typeName = context.resolveExpressionType(phrase.type).atomicClassArray().shift();
        let memberName = '__construct';
        if (!typeName) {
            return null;
        }
        return this.symbolStore.lookupTypeMember({
            typeName: typeName,
            memberPredicate: (x) => {
                return x.kind === 32 /* Method */ && x.name === '__construct';
            }
        });
    }
    _getArgumentNumber(argList, context) {
        if (!parsedDocument_1.ParsedDocument.isPhrase(argList, [8 /* ArgumentExpressionList */])) {
            return 0;
        }
        let token = context.token;
        let delimeters = argList.children.filter((x) => {
            return x.tokenType === 93 /* Comma */ && x.offset <= token.offset;
        });
        return delimeters.length;
    }
    _isCallablePhrase(node) {
        switch (node.phraseType) {
            case 84 /* FunctionCallExpression */:
            case 110 /* MethodCallExpression */:
            case 148 /* ScopedCallExpression */:
            case 126 /* ObjectCreationExpression */:
                return true;
            default:
                return false;
        }
    }
}
exports.SignatureHelpProvider = SignatureHelpProvider;
