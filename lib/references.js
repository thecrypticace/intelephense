/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const types_2 = require("./types");
const nameResolverVisitor_1 = require("./nameResolverVisitor");
const typeResolver_1 = require("./typeResolver");
const parseTreeHelper_1 = require("./parseTreeHelper");
const util_1 = require("./util");
class ReferenceReader extends types_1.MultiVisitor {
    constructor(nameResolverVisitor, variableTypeVisitor, referenceVisitor) {
        super([
            nameResolverVisitor,
            variableTypeVisitor,
            referenceVisitor
        ]);
        this.nameResolverVisitor = nameResolverVisitor;
        this.variableTypeVisitor = variableTypeVisitor;
        this.referenceVisitor = referenceVisitor;
    }
    get references() {
        return this.referenceVisitor.references;
    }
    static create(document, nameResolver, symbolStore, variableTable) {
        return new ReferenceReader(new nameResolverVisitor_1.NameResolverVisitor(document, nameResolver), new typeResolver_1.VariableTypeVisitor(document, nameResolver, symbolStore, variableTable), new ReferenceVisitor(document, nameResolver, symbolStore));
    }
}
exports.ReferenceReader = ReferenceReader;
class ReferenceVisitor {
    constructor(doc, nameResolver, symbolStore) {
        this.doc = doc;
        this.nameResolver = nameResolver;
        this.symbolStore = symbolStore;
        this._references = [];
        this._transformerStack = [];
    }
    get references() {
        return new DocumentReferences(this.doc.uri, this._references);
    }
    preorder(node, spine) {
        let parent = spine[spine.length - 1];
        switch (node.phraseType) {
            case 83 /* FullyQualifiedName */:
                this._transformerStack.push(new FullyQualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), parseTreeHelper_1.ParseTreeHelper.phraseToReferencesSymbolKind(parent)));
                return true;
            case 143 /* RelativeQualifiedName */:
                this._transformerStack.push(new RelativeQualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), this.nameResolver, parseTreeHelper_1.ParseTreeHelper.phraseToReferencesSymbolKind(parent)));
                return true;
            case 140 /* QualifiedName */:
                this._transformerStack.push(new QualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), this.nameResolver, parseTreeHelper_1.ParseTreeHelper.phraseToReferencesSymbolKind(parent)));
                return true;
            case 120 /* NamespaceName */:
                this._transformerStack.push(null);
                return false;
            case undefined:
                //tokens
                return false;
            default:
                this._transformerStack.push(null);
                return true;
        }
    }
    postorder(node, spine) {
        let parent = spine[spine.length - 1];
        let transformer = node.phraseType ? this._transformerStack.pop() : null;
        let parentTransformer = this._transformerStack.length ? this._transformerStack[this._transformerStack.length - 1] : null;
        let transform;
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
            case 143 /* RelativeQualifiedName */:
            case 83 /* FullyQualifiedName */:
                if ((transform = transformer.transform())) {
                    this._references.push(transform);
                }
                if (parentTransformer) {
                    parentTransformer.push(transform, node);
                }
                break;
            case 120 /* NamespaceName */:
                if (parentTransformer) {
                    parentTransformer.push(this.doc.nodeText(node), node);
                }
                break;
            default:
                break;
        }
    }
}
exports.ReferenceVisitor = ReferenceVisitor;
class FullyQualifiedNameTransformer {
    constructor(symbolStore, range, kind) {
        this.symbolStore = symbolStore;
        this.range = range;
        this.kind = kind;
        switch (kind) {
            case 64 /* Function */:
                this._kindPredicate = this.isFunction;
                break;
            case 8 /* Constant */:
                this._kindPredicate = this.isConstant;
                break;
            default:
                this._kindPredicate = this.isTraitInterfaceClass;
                break;
        }
    }
    push(value, node) {
        if (node.phraseType === 120 /* NamespaceName */) {
            this._name = value;
        }
    }
    transform() {
        let name = this.fqn();
        if (!name) {
            return null;
        }
        let matches = this.symbolStore.match(this._name, this._kindPredicate);
        if (matches.length > 0) {
            return {
                range: this.range,
                symbol: matches.length > 1 ? matches : matches.pop()
            };
        }
        return null;
    }
    fqn() {
        return this._name;
    }
    isFunction(x) {
        return x.kind === 64 /* Function */;
    }
    isConstant(x) {
        return x.kind === 8 /* Constant */;
    }
    isTraitInterfaceClass(x) {
        return (x.kind & (1 /* Class */ | 4 /* Trait */ | 2 /* Interface */)) > 0;
    }
}
class RelativeQualifiedNameTransformer extends FullyQualifiedNameTransformer {
    constructor(symbolStore, range, nameResolver, kind) {
        super(symbolStore, range, kind);
        this.symbolStore = symbolStore;
        this.range = range;
        this.nameResolver = nameResolver;
        this.kind = kind;
    }
    fqn() {
        return this.nameResolver.resolveRelative(this._name);
    }
}
class QualifiedNameTransformer extends FullyQualifiedNameTransformer {
    constructor(symbolStore, range, nameResolver, kind) {
        super(symbolStore, range, kind);
        this.symbolStore = symbolStore;
        this.range = range;
        this.nameResolver = nameResolver;
        this.kind = kind;
    }
    fqn() {
        return this.nameResolver.resolveNotFullyQualified(this._name, this.kind);
    }
}
class DocumentReferences {
    constructor(uri, references) {
        this._uri = uri;
        this._references = references;
        this._search = new types_2.BinarySearch(this._references);
    }
    filter(predicate) {
        let matches = [];
        let ref;
        for (let n = 0, l = this._references.length; n < l; ++n) {
            ref = this._references[n];
            if (predicate(ref)) {
                matches.push(ref);
            }
        }
        return matches;
    }
    referenceAtPosition(position) {
        let fn = (x) => {
            return util_1.isInRange(position, x.range.start, x.range.end);
        };
        return this._search.find(fn);
    }
}
exports.DocumentReferences = DocumentReferences;
