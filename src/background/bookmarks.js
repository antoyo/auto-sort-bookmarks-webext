/*
 * Copyright (C) 2014-2017  Boucher, Antoni <bouanto@zoho.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

/* global bookmarkService, prefs, getDescription, isSmartBookmark, isLivemark */

/* exported getRootFolders, getChildrenFolders */

/**
 * Item class.
 */
class Item {
    /**
     * Get an item.
     *
     * @param itemID
     * @param index
     * @param parentID
     */
    constructor(itemID, index, parentID) {
        this.id = itemID;
        this.setIndex(index);
        this.parentID = parentID;
    }

    /**
     * Get the parent folder.
     *
     * @return {Item} The parent folder.
     */
    getFolder() {
        return createItem(bookmarkService.TYPE_FOLDER, this.parentID);
    }

    /**
     * Save the new index.
     */
    saveIndex() {
        try {
            bookmarkService.setItemIndex(this.id, this.index);
        }
        catch (exception) {
            // console.error("failed to move " + this.id + ". " + this.title + " to " + this.index + " (" + this.url + ")");
        }
    }

    /**
     * Set the new `index` saving the old index.
     *
     * @param {int} index The new index.
     */
    setIndex(index) {
        this.oldIndex = this.index || index;
        this.index = index;
    }
}

/**
 * Bookmark class.
 */
class Bookmark extends Item {
    /**
     * Get a bookmark.
     *
     * @param {int} itemID The bookmark identifier.
     * @param {int} index The bookmark position.
     * @param {int} parentID The bookmark parent identifier.
     * @param {string} title The bookmark title.
     * @param {string} url The item URL.
     * @param {int} lastVisited The timestamp of the last visit.
     * @param {int} accessCount The access count.
     * @param {int} dateAdded The timestamp of the date added.
     * @param {int} lastModified The timestamp of the last modified date.
     */
    constructor(itemID, index, parentID, title, dateAdded, lastModified, url, lastVisited, accessCount) {
        super(itemID, index, parentID);

        if (title === null || dateAdded === null || lastModified === null || url === null || lastVisited === null || accessCount === null) {
            // console.error("Corrupted bookmark found. ID: " + itemID + " - Title: " + title + " - URL: " + url);
            this.corrupted = true;
        }

        this.title = title || "";
        this.url = url || "";
        this.lastVisited = lastVisited || 0;
        this.accessCount = accessCount || 0;
        this.dateAdded = dateAdded || 0;
        this.lastModified = lastModified || 0;
        this.order = prefs.bookmark_sort_order || 4;
        this.description = getDescription(this) || "";
        this.setKeyword();
    }

    /**
     * Fetch the keyword and set it to the current bookmark.
     */
    setKeyword() {
        let keyword = "";
        try {
            keyword = bookmarkService.getKeywordForBookmark(this.id);
            keyword = keyword || "";
        }
        catch (exception) {
            // Nothing to do.
        }

        this.keyword = keyword;
    }
}

/**
 * Determine if bookmark exists.
 *
 * @param itemID
 * @returns {boolean}
 */
Bookmark.exists = function (itemID) {
    return bookmarkService.getItemIndex(itemID) >= 0;
};

/**
 * Bookmark manager class.
 */
class BookmarkManager extends EventTarget {
    /**
     * Create a new bookmark observer.
     *
     * @param options
     */
    constructor(options) {
        super(options);
        merge(this, options);
        this.createObserver();
    }

    /**
     * Create a bookmark observer.
     */
    createObserver() {
        let self = this;

        let bookmarkObserver = {
            onItemAdded() {
                emit(self, "changed");
            },

            onItemChanged() {
                emit(self, "changed");
            },

            onItemMoved() {
                emit(self, "changed");
            },

            onItemRemoved(itemID, parentID, index, itemType) {
                if (itemType === 3) {
                    emit(self, "changed");
                }
            },

            onItemVisited() {
                emit(self, "changed");
            },

            QueryInterface: XPCOMUtils.generateQI([Ci.nsINavBookmarkObserver]),
        };

        BookmarkManager.prototype.observers.push(bookmarkObserver);
        bookmarkService.addObserver(bookmarkObserver, false);
    }
}

BookmarkManager.prototype.observers = [];

/**
 * Separator class.
 */
class Separator extends Item {
    /**
     * Get a separator.
     *
     * @param {int} itemID The separator identifier.
     * @param {int} index The separator position.
     * @param {int} parentID The separator parent identifier.
     */
    constructor(itemID, index, parentID) {
        super(itemID, index, parentID);
    }
}

/**
 * Folder class.
 */
class Folder extends Bookmark {
    /**
     * Get an existing folder.
     *
     * @param {int} itemID The folder identifier.
     * @param {int} index The folder position.
     * @param {int} parentID The folder parent identifier.
     * @param {string} title The folder title.
     * @param dateAdded
     * @param lastModified
     */
    constructor(itemID, index, parentID, title, dateAdded, lastModified) {
        super(itemID, index, parentID, title, dateAdded, lastModified);
        this.order = prefs.folder_sort_order || 1;
    }

    /**
     * Check if this folder can be sorted.
     *
     * @return {boolean} Whether it can be sorted or not.
     */
    canBeSorted() {
        if (hasDoNotSortAnnotation(this.id) || this.hasAncestorExcluded()) {
            return false;
        }

        return !this.isRoot();
    }

    /**
     * Get the immediate children.
     *
     * @return {Array.<Item>} The children.
     */
    getChildren() {
        let index = 0;

        this.children = [[]];

        let options = historyService.getNewQueryOptions();
        options.queryType = historyService.QUERY_TYPE_BOOKMARKS;

        let query = historyService.getNewQuery();
        query.setFolders([this.id], 1);

        let result = historyService.executeQuery(query, options);

        let rootNode = result.root;
        rootNode.containerOpen = true;

        for (let i = 0; i < rootNode.childCount; ++i) {
            let node = rootNode.getChild(i);
            let item = createItemFromNode(node, this.id);
            if (item instanceof Separator) {
                this.children.push([]);
                ++index;
            }
            else if (item !== undefined) {
                this.children[index].push(item);
            }
        }

        rootNode.containerOpen = false;

        return this.children;
    }

    /**
     * Get folders recursively.
     */
    getFolders() {
        let folders = [];
        let folder;
        let node;

        let options = historyService.getNewQueryOptions();
        options.excludeItems = true;
        options.excludeQueries = true;
        options.queryType = historyService.QUERY_TYPE_BOOKMARKS;

        let query = historyService.getNewQuery();
        query.setFolders([this.id], 1);

        let result = historyService.executeQuery(query, options);

        let rootNode = result.root;
        rootNode.containerOpen = true;

        for (let i = 0; i < rootNode.childCount; ++i) {
            node = rootNode.getChild(i);

            if (!isRecursivelyExcluded(node.itemId)) {
                folder = new Folder(node.itemId, node.bookmarkIndex, this.id, node.title, node.dateAdded, node.lastModified);

                if (!isLivemark(folder.id)) {
                    folders.push(folder);

                    for (let f of folder.getFolders()) {
                        folders.push(f);
                    }
                }
            }
        }

        rootNode.containerOpen = false;

        return folders;
    }

    /**
     * Check if this folder has an ancestor that is recursively excluded.
     */
    hasAncestorExcluded() {
        if (isRecursivelyExcluded(this.id)) {
            return true;
        }
        else {
            let parentID = bookmarkService.getFolderIdForItem(this.id);
            if (parentID > 0) {
                let parentFolder = createItem(bookmarkService.TYPE_FOLDER, parentID);
                return parentFolder.hasAncestorExcluded();
            }
        }

        return false;
    }

    /**
     * Check if this folder is a root folder (menu, toolbar, unsorted).
     *
     * @return {boolean} Whether this is a root folder or not.
     */
    isRoot() {
        return this.id === bookmarkService.placesRoot;
    }

    /**
     * Check if at least one children has moved.
     *
     * @return {boolean} Whether at least one children has moved or not.
     */
    hasMove() {
        for (let i = 0; i < this.children.length; ++i) {
            let length = this.children[i].length;
            for (let j = 0; j < length; ++j) {
                if (this.children[i][j].index !== this.children[i][j].oldIndex) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Save the new children positions.
     */
    save() {
        if (this.hasMove()) {
            for (let i = 0; i < this.children.length; ++i) {
                let length = this.children[i].length;
                for (let j = 0; j < length; ++j) {
                    this.children[i][j].saveIndex();
                }
            }
        }
    }
}

/**
 * Livemark class.
 */
class Livemark extends Bookmark {
    /**
     * Get an existing smart bookmark.
     *
     * @param {int} itemID The folder identifier.
     * @param {int} index The folder position.
     * @param {int} parentID The folder parent identifier.
     * @param {string} title The folder title.
     * @param dateAdded
     * @param lastModified
     */
    constructor(itemID, index, parentID, title, dateAdded, lastModified) {
        super(itemID, index, parentID, title, dateAdded, lastModified);
        this.order = prefs.livemark_sort_order || 2;
    }
}

/**
 * Smart bookmark class.
 */
class SmartBookmark extends Bookmark {
    /**
     * Get an existing smart bookmark.
     *
     * @param {int} itemID The folder identifier.
     * @param {int} index The folder position.
     * @param {int} parentID The folder parent identifier.
     * @param {string} title The folder title.
     */
    constructor(itemID, index, parentID, title) {
        super(itemID, index, parentID, title);
        this.order = prefs.smart_bookmark_sort_order || 3;
    }
}

/**
 * Create an item from the `type`.
 *
 * @param {int} type The item type.
 * @param {int} itemID The item ID.
 * @param {int} parentID The parent ID.
 * @param {string} title The item title.
 * @param {string} url The item URL.
 * @param {int} lastVisited The timestamp of the last visit.
 * @param {int} accessCount The access count.
 * @param {int} dateAdded The timestamp of the date added.
 * @param {int} lastModified The timestamp of the last modified date.
 * @return {*} The new item.
 * @param index
 */
function createItem(type, itemID, index, parentID, title, url, lastVisited, accessCount, dateAdded, lastModified) {
    let item;
    switch (type) {
        case bookmarkService.TYPE_BOOKMARK:
            if (isSmartBookmark(itemID)) {
                item = new SmartBookmark(itemID, index, parentID, title);
            }
            else {
                item = new Bookmark(itemID, index, parentID, title, dateAdded, lastModified, url, lastVisited, accessCount);
            }

            break;
        case bookmarkService.TYPE_FOLDER:
            if (isLivemark(itemID)) {
                item = new Livemark(itemID, index, parentID, title, dateAdded, lastModified);
            }
            else {
                item = new Folder(itemID, index, parentID, title, dateAdded, lastModified);
            }

            break;
        case bookmarkService.TYPE_SEPARATOR:
            item = new Separator(itemID, index, parentID);
            break;
    }

    return item;
}

/**
 * Create an item from the `node` type.
 *
 * @param {object} node The node item.
 * @param {int} parentID The parent ID.
 * @return {Item} The new item.
 */
function createItemFromNode(node, parentID) {
    let type;
    switch (node.type) {
        case node.RESULT_TYPE_URI:
            type = bookmarkService.TYPE_BOOKMARK;
            break;
        case node.RESULT_TYPE_FOLDER:
            type = bookmarkService.TYPE_FOLDER;
            break;
        case node.RESULT_TYPE_SEPARATOR:
            type = bookmarkService.TYPE_SEPARATOR;
            break;
        case node.RESULT_TYPE_QUERY:
            type = bookmarkService.TYPE_BOOKMARK;
            break;
    }

    return createItem(type, node.itemId, node.bookmarkIndex, parentID, node.title, node.uri, node.time, node.accessCount, node.dateAdded, node.lastModified);
}

/**
 * Get the children folders of a folder.
 *
 * @param parentID
 * @return {Array}
 */
function getChildrenFolders(parentID) {
    let children = [];
    let folder;
    let node;

    let options = historyService.getNewQueryOptions();
    options.excludeItems = true;
    options.excludeQueries = true;
    options.queryType = historyService.QUERY_TYPE_BOOKMARKS;

    let query = historyService.getNewQuery();
    query.setFolders([parentID], 1);

    let result = historyService.executeQuery(query, options);

    let rootNode = result.root;
    rootNode.containerOpen = true;

    for (let i = 0; i < rootNode.childCount; ++i) {
        node = rootNode.getChild(i);

        folder = new Folder(node.itemId, node.bookmarkIndex, parentID, node.title, node.dateAdded, node.lastModified);

        if (!isLivemark(folder.id)) {
            children.push({
                id: folder.id,
                title: folder.title,
                excluded: hasDoNotSortAnnotation(folder.id),
                recursivelyExcluded: hasRecursiveAnnotation(folder.id),
            });
        }
    }

    rootNode.containerOpen = false;

    return children;
}

/**
 * The bookmarks menu folder.
 *
 * @type {Folder}
 */
let menuFolder = new Folder(bookmarkService.bookmarksMenuFolder);

/**
 * The bookmarks toolbar folder.
 *
 * @type {Folder}
 */
let toolbarFolder = new Folder(bookmarkService.toolbarFolder);

/**
 * The unsorted bookmarks folder.
 *
 * @type {Folder}
 */
let unsortedFolder = new Folder(bookmarkService.unfiledBookmarksFolder);

/**
 * Get the root folders.
 */
function getRootFolders() {
    let folders = [];
    for (let folder of [menuFolder, toolbarFolder, unsortedFolder]) {
        folders.push({
            id: folder.id,
            excluded: hasDoNotSortAnnotation(folder.id),
            recursivelyExcluded: hasRecursiveAnnotation(folder.id),
        });
    }

    folders[0].title = _("Bookmarks Menu");
    folders[1].title = _("Bookmarks Toolbar");
    folders[2].title = _("Unsorted Bookmarks");

    return folders;
}

when(function () {
    for (let observer of BookmarkManager.prototype.observers) {
        bookmarkService.removeObserver(observer);
    }
});