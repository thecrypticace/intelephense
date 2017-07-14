/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const context_1 = require("./context");
const typeString_1 = require("./typeString");
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
        if (!callableExpr || parsedDocument_1.ParsedDocument.isToken(context.token, [121 /* CloseParenthesis */])) {
            return null;
        }
        let symbol = this._getSymbol(callableExpr, context);
        let argNumber = this._getArgumentNumber(callableExpr.children.find((x) => {
            return parsedDocument_1.ParsedDocument.isPhrase(x, [8 /* ArgumentExpressionList */]);
        }), context);
        return symbol ? this._createSignatureHelp(symbol, argNumber) : null;
    }
    _createSignatureHelp(fn, argNumber) {
        if (!fn.children) {
            return null;
        }
        let params = fn.children.filter((x) => {
            return x.kind === 128 /* Parameter */;
        });
        if (!params.length || argNumber > params.length - 1) {
            return null;
        }
        let nOptionalParams = params.reduce((carry, value) => {
            return value.value ? carry + 1 : carry;
        }, 0);
        let nRequiredParams = params.length - nOptionalParams;
        let signatures = [];
        if (nRequiredParams > 0) {
            signatures.push(this._signatureInfo(fn, params.slice(0, nRequiredParams)));
        }
        for (let n = 1; n <= nOptionalParams; ++n) {
            signatures.push(this._signatureInfo(fn, params.slice(0, nRequiredParams + n)));
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
        let returnType = symbol_1.PhpSymbol.type(fn);
        if (returnType) {
            label += ': ' + returnType;
        }
        let info = {
            label: label,
            parameters: paramInfoArray
        };
        if (fn.doc && fn.doc.description) {
            info.documentation = fn.doc.description;
        }
        return info;
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
        let paramType = symbol_1.PhpSymbol.type(s);
        if (paramType) {
            labelParts.push(paramType);
        }
        labelParts.push(s.name);
        if (s.value) {
            labelParts.push('= ' + s.value);
        }
        let info = {
            label: labelParts.join(' '),
        };
        if (s.doc && s.doc.description) {
            info.documentation = s.doc.description;
        }
        return info;
    }
    _getSymbol(callableExpr, context) {
        switch (callableExpr.phraseType) {
            case 84 /* FunctionCallExpression */:
                return this._functionCallExpressionSymbol(callableExpr, context);
            case 111 /* MethodCallExpression */:
                return this._methodCallExpressionSymbol(callableExpr, context);
            case 149 /* ScopedCallExpression */:
                return this._scopedCallExpressionSymbol(callableExpr, context);
            case 127 /* ObjectCreationExpression */:
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
        let typeNames = typeString_1.TypeString.atomicClassArray(context.resolveExpressionType(phrase.variable));
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
        let typeNames = typeString_1.TypeString.atomicClassArray(context.resolveExpressionType(phrase.scope));
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
        let typeName = typeString_1.TypeString.atomicClassArray(context.resolveExpressionType(phrase.type)).shift();
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
            case 111 /* MethodCallExpression */:
            case 149 /* ScopedCallExpression */:
            case 127 /* ObjectCreationExpression */:
                return true;
            default:
                return false;
        }
    }
}
exports.SignatureHelpProvider = SignatureHelpProvider;
