/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
class Event {
    constructor() {
        this._subscribed = [];
    }
    subscribe(handler) {
        this._subscribed.push(handler);
        let index = this._subscribed.length - 1;
        let subscribed = this._subscribed;
        return () => {
            subscribed.splice(index, 1);
        };
    }
    trigger(args) {
        let handler;
        for (let n = 0; n < this._subscribed.length; ++n) {
            handler = this._subscribed[n];
            handler(args);
        }
    }
}
exports.Event = Event;
class TreeTraverser {
    constructor(spine) {
        this._spine = spine.slice(0);
    }
    get spine() {
        return this._spine.slice(0);
    }
    get node() {
        return this._spine.length ? this._spine[this._spine.length - 1] : null;
    }
    traverse(visitor) {
        this._traverse(this.node, visitor, this._spine.slice(0));
    }
    filter(predicate) {
        let visitor = new FilterVisitor(predicate);
        this.traverse(visitor);
        return visitor.array;
    }
    toArray() {
        let visitor = new ToArrayVisitor();
        this.traverse(visitor);
        return visitor.array;
    }
    count() {
        let visitor = new CountVisitor();
        this.traverse(visitor);
        return visitor.count;
    }
    depth() {
        return this._spine.length - 1;
    }
    up(n) {
        let steps = Math.max(this._spine.length - 1, n);
        this._spine = this._spine.slice(0, this._spine.length - steps);
    }
    find(predicate) {
        let visitor = new FindVisitor(predicate);
        this.traverse(visitor);
        if (visitor.found) {
            this._spine = visitor.found;
            return this.node;
        }
        return null;
    }
    prevSibling() {
        if (this._spine.length < 2) {
            return null;
        }
        let parent = this._spine[this._spine.length - 2];
        let childIndex = parent.children.indexOf(this);
        if (childIndex > 0) {
            this._spine.pop();
            this._spine.push(parent.children[childIndex - 1]);
            return this.node;
        }
        else {
            return null;
        }
    }
    nextSibling() {
        if (this._spine.length < 2) {
            return null;
        }
        let parent = this._spine[this._spine.length - 2];
        let childIndex = parent.children.indexOf(this);
        if (childIndex < parent.children.length - 1) {
            this._spine.pop();
            this._spine.push(parent.children[childIndex + 1]);
            return this.node;
        }
        else {
            return null;
        }
    }
    ancestor(predicate) {
        for (let n = this._spine.length - 2; n >= 0; --n) {
            if (predicate(this._spine[n])) {
                this._spine = this._spine.slice(0, n + 1);
                return this.node;
            }
        }
        return null;
    }
    parent() {
        if (this._spine.length > 1) {
            this._spine.pop();
            return this.node;
        }
        return null;
    }
    clone() {
        return new TreeTraverser(this._spine);
    }
    _traverse(treeNode, visitor, spine) {
        if (visitor.haltTraverse) {
            return;
        }
        let descend = true;
        if (visitor.preorder) {
            descend = visitor.preorder(treeNode, spine);
            if (visitor.haltTraverse) {
                return;
            }
        }
        if (treeNode.children && descend) {
            spine.push(treeNode);
            for (let n = 0, l = treeNode.children.length; n < l; ++n) {
                this._traverse(treeNode.children[n], visitor, spine);
                if (visitor.haltTraverse) {
                    return;
                }
            }
            spine.pop();
        }
        if (visitor.postorder) {
            visitor.postorder(treeNode, spine);
        }
    }
}
exports.TreeTraverser = TreeTraverser;
class FilterVisitor {
    constructor(predicate) {
        this._predicate = predicate;
        this._array = [];
    }
    get array() {
        return this._array;
    }
    preorder(node, spine) {
        if (this._predicate(node)) {
            this._array.push(node);
        }
        return true;
    }
}
class FindVisitor {
    constructor(predicate) {
        this._predicate = predicate;
        this.haltTraverse = false;
    }
    get found() {
        return this._found;
    }
    preorder(node, spine) {
        if (this._predicate(node)) {
            this._found = spine.slice(0);
            this._found.push(node);
            this.haltTraverse = true;
            return false;
        }
        return true;
    }
}
class Debounce {
    constructor(handler, wait) {
        this.wait = wait;
        this.clear = () => {
            clearTimeout(this._timer);
            this._timer = null;
            this._lastEvent = null;
        };
        this._handler = handler;
        this.wait = wait;
    }
    handle(event) {
        this.clear();
        this._lastEvent = event;
        let that = this;
        let handler = this._handler;
        let clear = this.clear;
        let later = () => {
            handler.apply(that, [event]);
            clear();
        };
        this._timer = setTimeout(later, this.wait);
    }
    flush() {
        if (!this._timer) {
            return;
        }
        let event = this._lastEvent;
        this.clear();
        this._handler.apply(this, [event]);
    }
}
exports.Debounce = Debounce;
class ToArrayVisitor {
    constructor() {
        this._array = [];
    }
    get array() {
        return this._array;
    }
    preorder(t, spine) {
        this._array.push(t);
        return true;
    }
}
exports.ToArrayVisitor = ToArrayVisitor;
class CountVisitor {
    constructor() {
        this._count = 0;
    }
    get count() {
        return this._count;
    }
    preorder(t, spine) {
        ++this._count;
        return true;
    }
}
exports.CountVisitor = CountVisitor;
class MultiVisitor {
    constructor(visitors) {
        this.haltTraverse = false;
        this._visitors = [];
        for (let n = 0; n < visitors.length; ++n) {
            this.add(visitors[n]);
        }
    }
    add(v) {
        this._visitors.push([v, null]);
    }
    preorder(node, spine) {
        let v;
        let descend;
        for (let n = 0; n < this._visitors.length; ++n) {
            v = this._visitors[n];
            if (!v[1] && v[0].preorder && !v[0].preorder(node, spine)) {
                v[1] = node;
            }
            if (v[0].haltTraverse) {
                this.haltTraverse = true;
                break;
            }
        }
        return true;
    }
    postorder(node, spine) {
        let v;
        for (let n = 0; n < this._visitors.length; ++n) {
            v = this._visitors[n];
            if (v[1] === node) {
                v[1] = null;
            }
            if (!v[1] && v[0].postorder) {
                v[0].postorder(node, spine);
            }
            if (v[0].haltTraverse) {
                this.haltTraverse = true;
                break;
            }
        }
    }
}
exports.MultiVisitor = MultiVisitor;
class BinarySearch {
    constructor(sortedArray) {
        this._sortedArray = sortedArray;
    }
    find(compare) {
        let result = this.search(compare);
        return result.isExactMatch ? this._sortedArray[result.rank] : null;
    }
    rank(compare) {
        return this.search(compare).rank;
    }
    range(compareLower, compareUpper) {
        let rankLower = this.rank(compareLower);
        return this._sortedArray.slice(rankLower, this.search(compareUpper, rankLower).rank);
    }
    search(compare, offset) {
        let left = offset ? offset : 0;
        let right = this._sortedArray.length - 1;
        let mid = 0;
        let compareResult = 0;
        let searchResult;
        while (true) {
            if (left > right) {
                searchResult = { rank: left, isExactMatch: false };
                break;
            }
            mid = Math.floor((left + right) / 2);
            compareResult = compare(this._sortedArray[mid]);
            if (compareResult < 0) {
                left = mid + 1;
            }
            else if (compareResult > 0) {
                right = mid - 1;
            }
            else {
                searchResult = { rank: mid, isExactMatch: true };
                break;
            }
        }
        return searchResult;
    }
}
exports.BinarySearch = BinarySearch;
