// RTCMultiConnection.js

function RTCMultiConnection(roomid, forceOptions) {
    forceOptions = forceOptions || {};

    var connection = this;

    connection.channel = connection.sessionid = (roomid || location.href.replace(/\/|:|#|\?|\$|\^|%|\.|`|~|!|\+|@|\[|\||]|\|*. /g, '').split('\n').join('').split('\r').join('')) + '';

    var mPeer = new MultiPeers(connection);

    mPeer.onGettingLocalMedia = function(stream) {
        stream.type = 'local';
        setStreamEndHandler(stream);

        getRMCMediaElement(stream, function(mediaElement) {
            mediaElement.id = stream.streamid;
            mediaElement.muted = true;
            mediaElement.volume = 0;

            if (connection.attachStreams.indexOf(stream) === -1) {
                connection.attachStreams.push(stream);
            }

            if (typeof StreamsHandler !== 'undefined') {
                StreamsHandler.setHandlers(stream, true, connection);
            }

            connection.streamEvents[stream.streamid] = {
                stream: stream,
                type: 'local',
                mediaElement: mediaElement,
                userid: connection.userid,
                extra: connection.extra,
                streamid: stream.streamid,
                blobURL: mediaElement.src || URL.createObjectURL(stream),
                isAudioMuted: true
            };

            setHarkEvents(connection, connection.streamEvents[stream.streamid]);
            setMuteHandlers(connection, connection.streamEvents[stream.streamid]);

            connection.onstream(connection.streamEvents[stream.streamid]);
        }, connection);

        connection.observers.all();
    };

    mPeer.onGettingRemoteMedia = function(stream, remoteUserId) {
        stream.type = 'remote';
        setStreamEndHandler(stream, 'remote-stream');

        getRMCMediaElement(stream, function(mediaElement) {
            mediaElement.id = stream.streamid;

            if (typeof StreamsHandler !== 'undefined') {
                StreamsHandler.setHandlers(stream, false, connection);
            }

            connection.streamEvents[stream.streamid] = {
                stream: stream,
                type: 'remote',
                userid: remoteUserId,
                extra: connection.peers[remoteUserId] ? connection.peers[remoteUserId].extra : {},
                mediaElement: mediaElement,
                streamid: stream.streamid,
                blobURL: mediaElement.src || URL.createObjectURL(stream)
            };

            setMuteHandlers(connection, connection.streamEvents[stream.streamid]);

            connection.onstream(connection.streamEvents[stream.streamid]);
        }, connection);
    };

    mPeer.onRemovingRemoteMedia = function(stream, remoteUserId) {
        var streamEvent = connection.streamEvents[stream.streamid];
        if (!streamEvent) {
            streamEvent = {
                stream: stream,
                type: 'remote',
                userid: remoteUserId,
                extra: connection.peers[remoteUserId] ? connection.peers[remoteUserId].extra : {},
                streamid: stream.streamid,
                mediaElement: connection.streamEvents[stream.streamid] ? connection.streamEvents[stream.streamid].mediaElement : null
            };
        }

        connection.onstreamended(streamEvent);

        delete connection.streamEvents[stream.streamid];
    };

    mPeer.onNegotiationNeeded = function(message, remoteUserId, callback) {
        connectSocket(function() {
            socket.emit(connection.socketMessageEvent, 'password' in message ? message : {
                remoteUserId: message.remoteUserId || remoteUserId,
                message: message,
                sender: connection.userid
            }, callback || function() {});
        });
    };

    function onUserLeft(remoteUserId) {
        connection.deletePeer(remoteUserId);
    }

    mPeer.onUserLeft = onUserLeft;
    mPeer.disconnectWith = function(remoteUserId, callback) {
        if (socket) {
            socket.emit('disconnect-with', remoteUserId, callback || function() {});
        }

        connection.deletePeer(remoteUserId);
    };

    connection.broadcasters = [];

    connection.socketOptions = {
        // 'force new connection': true, // For SocketIO version < 1.0
        // 'forceNew': true, // For SocketIO version >= 1.0
        'transport': 'polling' // fixing transport:unknown issues
    };

    var socket;

    function connectSocket(connectCallback) {
        if (socket) { // todo: check here readySate/etc. to make sure socket is still opened
            if (connectCallback) {
                connectCallback(socket);
            }
            return;
        }

        if (typeof SocketConnection === 'undefined') {
            if (typeof FirebaseConnection !== 'undefined') {
                window.SocketConnection = FirebaseConnection;
            } else if (typeof PubNubConnection !== 'undefined') {
                window.SocketConnection = PubNubConnection;
            } else {
                throw 'SocketConnection.js seems missed.';
            }
        }

        socket = new SocketConnection(connection, function(s) {
            socket = s;
            if (connectCallback) {
                connectCallback(socket);
            }
        });
    }

    connection.openOrJoin = function(localUserid, password) {
        connection.checkPresence(localUserid, function(isRoomExists, roomid) {
            if (typeof password === 'function') {
                password(isRoomExists, roomid);
                password = null;
            }

            if (isRoomExists) {
                connection.sessionid = roomid;

                var localPeerSdpConstraints = false;
                var remotePeerSdpConstraints = false;
                var isOneWay = !!connection.session.oneway;
                var isDataOnly = isData(connection.session);

                remotePeerSdpConstraints = {
                    OfferToReceiveAudio: connection.sdpConstraints.mandatory.OfferToReceiveAudio,
                    OfferToReceiveVideo: connection.sdpConstraints.mandatory.OfferToReceiveVideo
                }

                localPeerSdpConstraints = {
                    OfferToReceiveAudio: isOneWay ? !!connection.session.audio : connection.sdpConstraints.mandatory.OfferToReceiveAudio,
                    OfferToReceiveVideo: isOneWay ? !!connection.session.video || !!connection.session.screen : connection.sdpConstraints.mandatory.OfferToReceiveVideo
                }

                var connectionDescription = {
                    remoteUserId: connection.sessionid,
                    message: {
                        newParticipationRequest: true,
                        isOneWay: isOneWay,
                        isDataOnly: isDataOnly,
                        localPeerSdpConstraints: localPeerSdpConstraints,
                        remotePeerSdpConstraints: remotePeerSdpConstraints
                    },
                    sender: connection.userid,
                    password: password || false
                };

                mPeer.onNegotiationNeeded(connectionDescription);
                return;
            }

            var oldUserId = connection.userid;
            connection.userid = connection.sessionid = localUserid || connection.sessionid;
            connection.userid += '';

            socket.emit('changed-uuid', connection.userid);

            if (password) {
                socket.emit('set-password', password);
            }

            connection.isInitiator = true;

            if (isData(connection.session)) {
                return;
            }

            connection.captureUserMedia();
        });
    };

    connection.open = function(localUserid, isPublicModerator) {
        var oldUserId = connection.userid;
        connection.userid = connection.sessionid = localUserid || connection.sessionid;
        connection.userid += '';

        connection.isInitiator = true;

        connectSocket(function() {
            socket.emit('changed-uuid', connection.userid);

            if (isPublicModerator == true) {
                connection.becomePublicModerator();
            }
        });

        if (isData(connection.session)) {
            if (typeof isPublicModerator === 'function') {
                isPublicModerator();
            }
            return;
        }

        connection.captureUserMedia(typeof isPublicModerator === 'function' ? isPublicModerator : null);
    };

    connection.becomePublicModerator = function() {
        if (!connection.isInitiator) return;
        socket.emit('become-a-public-moderator');
    };

    connection.dontMakeMeModerator = function() {
        socket.emit('dont-make-me-moderator');
    };

    connection.deletePeer = function(remoteUserId) {
        if (!remoteUserId) {
            return;
        }

        connection.onleave({
            userid: remoteUserId,
            extra: connection.peers[remoteUserId] ? connection.peers[remoteUserId].extra : {}
        });

        if (!!connection.peers[remoteUserId]) {
            connection.peers[remoteUserId].streams.forEach(function(stream) {
                stream.stop();
            });

            var peer = connection.peers[remoteUserId].peer;
            if (peer && peer.iceConnectionState !== 'closed') {
                try {
                    peer.close();
                } catch (e) {}
            }

            connection.peers[remoteUserId].peer = null;
            delete connection.peers[remoteUserId];
        }

        if (connection.broadcasters.indexOf(remoteUserId) !== -1) {
            var newArray = [];
            connection.broadcasters.forEach(function(broadcaster) {
                if (broadcaster !== remoteUserId) {
                    newArray.push(broadcaster);
                }
            });
            connection.broadcasters = newArray;

            keepNextBroadcasterOnServer();
        }
    }

    connection.rejoin = function(connectionDescription) {
        if (connection.isInitiator || !connectionDescription || !Object.keys(connectionDescription).length) {
            return;
        }

        var extra = {};

        if (connection.peers[connectionDescription.remoteUserId]) {
            extra = connection.peers[connectionDescription.remoteUserId].extra;
            connection.deletePeer(connectionDescription.remoteUserId);
        }

        if (connectionDescription && connectionDescription.remoteUserId) {
            connection.join(connectionDescription.remoteUserId);

            connection.onReConnecting({
                userid: connectionDescription.remoteUserId,
                extra: extra
            });
        }
    };

    connection.join = connection.connect = function(remoteUserId, options) {
        connection.sessionid = (remoteUserId ? remoteUserId.sessionid || remoteUserId.remoteUserId || remoteUserId : false) || connection.sessionid;
        connection.sessionid += '';

        var localPeerSdpConstraints = false;
        var remotePeerSdpConstraints = false;
        var isOneWay = false;
        var isDataOnly = false;

        if ((remoteUserId && remoteUserId.session) || !remoteUserId || typeof remoteUserId === 'string') {
            var session = remoteUserId ? remoteUserId.session || connection.session : connection.session;

            isOneWay = !!session.oneway;
            isDataOnly = isData(session);

            remotePeerSdpConstraints = {
                OfferToReceiveAudio: connection.sdpConstraints.mandatory.OfferToReceiveAudio,
                OfferToReceiveVideo: connection.sdpConstraints.mandatory.OfferToReceiveVideo
            };

            localPeerSdpConstraints = {
                OfferToReceiveAudio: isOneWay ? !!connection.session.audio : connection.sdpConstraints.mandatory.OfferToReceiveAudio,
                OfferToReceiveVideo: isOneWay ? !!connection.session.video || !!connection.session.screen : connection.sdpConstraints.mandatory.OfferToReceiveVideo
            };
        }

        options = options || {};
        if (typeof options.localPeerSdpConstraints !== 'undefined') {
            localPeerSdpConstraints = options.localPeerSdpConstraints;
        }

        if (typeof options.remotePeerSdpConstraints !== 'undefined') {
            remotePeerSdpConstraints = options.remotePeerSdpConstraints;
        }

        if (typeof options.isOneWay !== 'undefined') {
            isOneWay = options.isOneWay;
        }

        if (typeof options.isDataOnly !== 'undefined') {
            isDataOnly = options.isDataOnly;
        }

        var connectionDescription = {
            remoteUserId: connection.sessionid,
            message: {
                newParticipationRequest: true,
                isOneWay: isOneWay,
                isDataOnly: isDataOnly,
                localPeerSdpConstraints: localPeerSdpConstraints,
                remotePeerSdpConstraints: remotePeerSdpConstraints
            },
            sender: connection.userid,
            password: false
        };

        connectSocket(function() {
            if (!!connection.peers[connection.sessionid]) {
                // on socket disconnect & reconnect
                return;
            }

            mPeer.onNegotiationNeeded(connectionDescription);
        });

        return connectionDescription;
    };

    connection.connectWithAllParticipants = function(remoteUserId) {
        mPeer.onNegotiationNeeded('connectWithAllParticipants', remoteUserId || connection.sessionid);
    };

    connection.removeFromBroadcastersList = function(remoteUserId) {
        mPeer.onNegotiationNeeded('removeFromBroadcastersList', remoteUserId || connection.sessionid);

        connection.peers.getAllParticipants(remoteUserId || connection.sessionid).forEach(function(participant) {
            mPeer.onNegotiationNeeded('dropPeerConnection', participant);
            connection.deletePeer(participant);
        });

        connection.attachStreams.forEach(function(stream) {
            stream.stop();
        });
    };

    connection.getUserMedia = connection.captureUserMedia = function(callback, session) {
        connection.observers.all();

        session = session || connection.session;

        if (connection.dontCaptureUserMedia || isData(session)) {
            if (callback) {
                callback();
            }
            return;
        }

        if (session.audio || session.video || session.screen) {
            if (session.screen) {
                connection.getScreenConstraints(function(error, screen_constraints) {
                    if (error) {
                        throw error;
                    }

                    invokeGetUserMedia({
                        video: screen_constraints,
                        isScreen: true
                    }, session.audio || session.video ? invokeGetUserMedia : false);
                });
            } else if (session.audio || session.video) {
                invokeGetUserMedia();
            }
        }

        function invokeGetUserMedia(localMediaConstraints, getUserMedia_callback) {
            var isScreen = false;
            if (localMediaConstraints) {
                isScreen = localMediaConstraints.isScreen;
                delete localMediaConstraints.isScreen;
            }

            getUserMediaHandler({
                onGettingLocalMedia: function(stream) {
                    stream.isAudio = stream.isVideo = stream.isScreen = false;

                    if (isScreen) {
                        stream.isScreen = true;
                    } else if (session.audio && session.video) {
                        stream.isVideo = true;
                    } else if (session.audio) {
                        stream.isAudio = true;
                    }

                    mPeer.onGettingLocalMedia(stream);

                    if (getUserMedia_callback) {
                        return getUserMedia_callback();
                    }

                    if (callback) {
                        callback(stream);
                    }
                },
                onLocalMediaError: function(error, constraints) {
                    mPeer.onLocalMediaError(error, constraints);

                    if (constraints.audio && constraints.video && (error.name || '').toString().indexOf('DevicesNotFound') !== -1) {
                        constraints.video = false;
                        invokeGetUserMedia(constraints, getUserMedia_callback);
                        return;
                    }

                    if (callback) {
                        callback();
                    }
                },
                localMediaConstraints: localMediaConstraints || {
                    audio: !!session.audio ? connection.mediaConstraints.audio : false,
                    video: !!session.video ? connection.mediaConstraints.video : false
                }
            });
        }
    };

    function beforeUnload(shiftModerationControlOnLeave, dontCloseSocket) {
        if (!connection.closeBeforeUnload) {
            return;
        }

        if (connection.isInitiator === true) {
            connection.dontMakeMeModerator();
        }

        connection.peers.getAllParticipants().forEach(function(participant) {
            mPeer.onNegotiationNeeded({
                userLeft: true
            }, participant);

            if (connection.peers[participant] && connection.peers[participant].peer) {
                connection.peers[participant].peer.close();
            }
        });

        if (socket && !dontCloseSocket) {
            if (typeof socket.disconnect !== 'undefined') {
                socket.disconnect();
            }
            socket = null;
        }

        connection.broadcasters = [];
        connection.isInitiator = false;
    }

    connection.closeBeforeUnload = true;
    window.addEventListener('beforeunload', beforeUnload, false);

    connection.userid = getRandomString();
    connection.changeUserId = function(newUserId) {
        connection.userid = newUserId || getRandomString();
        socket.emit('changed-uuid', connection.userid);
    };

    connection.observers = {
        extra: function() {
            observeObject(connection.extra, function(changes) {
                socket.emit('extra-data-updated', connection.extra);
            });
        },
        attachStreams: function() {
            observeObject(connection.attachStreams, function(changes) {
                changes.forEach(function(change) {
                    if (change.type === 'add') {
                        setStreamEndHandler(change.object[change.name]);
                    }

                    if (change.type === 'remove' || change.type === 'delete') {
                        if (connection.removeStreams.indexOf(change.object[change.name]) === -1) {
                            connection.removeStreams.push(change.object[change.name]);
                        }
                    }

                    connection.attachStreams = removeNullEntries(connection.attachStreams);
                    connection.removeStreams = removeNullEntries(connection.removeStreams);
                    connection.observers.all();
                });
            });
        },
        all: function() {
            this.extra();
            this.attachStreams();

            if (socket) {
                socket.emit('extra-data-updated', connection.extra);
            }
        }
    };
    connection.extra = {};
    connection.attachStreams = [];
    connection.removeStreams = [];
    connection.observers.all();

    connection.session = {
        audio: true,
        video: true
    };

    connection.enableFileSharing = false;

    // all values in kbps
    connection.bandwidth = {
        screen: 512,
        audio: 128,
        video: 512
    };

    connection.processSdp = function(sdp) {
        if (isMobileDevice || isFirefox) {
            return sdp;
        }

        sdp = BandwidthHandler.setApplicationSpecificBandwidth(sdp, connection.bandwidth, !!connection.session.screen);
        sdp = BandwidthHandler.setVideoBitrates(sdp, {
            min: connection.bandwidth.video * 8 * 1024,
            max: connection.bandwidth.video * 8 * 1024
        });
        sdp = BandwidthHandler.setOpusAttributes(sdp, {
            maxaveragebitrate: connection.bandwidth.audio * 8 * 1024,
            maxplaybackrate: connection.bandwidth.audio * 8 * 1024,
            stereo: 1,
            maxptime: 3
        });
        return sdp;
    };

    if (typeof BandwidthHandler !== 'undefined') {
        connection.BandwidthHandler = BandwidthHandler;
    }

    connection.mediaConstraints = {
        audio: {
            mandatory: {},
            optional: [{
                bandwidth: connection.bandwidth.audio * 8 * 1024 || 128 * 8 * 1024
            }]
        },
        video: {
            mandatory: {},
            optional: [{
                bandwidth: connection.bandwidth.audio * 8 * 1024 || 128 * 8 * 1024
            }, {
                googLeakyBucket: true
            }]
        }
    };

    if (isFirefox) {
        connection.mediaConstraints = {
            audio: true,
            video: true
        };
    }

    if (!forceOptions.useDefaultDevices) {
        DetectRTC.load(function() {
            var lastAudioDevice, lastVideoDevice;
            // it will force RTCMultiConnection to capture last-devices
            // i.e. if external microphone is attached to system, we should prefer it over built-in devices.
            DetectRTC.MediaDevices.forEach(function(device) {
                if (device.kind === 'audioinput' && connection.mediaConstraints.audio !== false) {
                    lastAudioDevice = device;
                }

                if (device.kind === 'videoinput' && connection.mediaConstraints.video !== false) {
                    lastVideoDevice = device;
                }
            });

            if (lastAudioDevice) {
                if (isFirefox) {
                    if (connection.mediaConstraints.audio !== true) {
                        connection.mediaConstraints.audio.deviceId = lastAudioDevice.id;
                    } else {
                        connection.mediaConstraints.audio = {
                            deviceId: lastAudioDevice.id
                        }
                    }
                    return;
                }

                if (connection.mediaConstraints.audio == true) {
                    connection.mediaConstraints.audio = {
                        mandatory: {},
                        optional: []
                    }
                }

                if (!connection.mediaConstraints.audio.optional) {
                    connection.mediaConstraints.audio.optional = [];
                }

                var optional = [{
                    sourceId: lastAudioDevice.id
                }];

                connection.mediaConstraints.audio.optional = optional.concat(connection.mediaConstraints.audio.optional);
            }

            if (lastVideoDevice) {
                if (isFirefox) {
                    if (connection.mediaConstraints.video !== true) {
                        connection.mediaConstraints.video.deviceId = lastVideoDevice.id;
                    } else {
                        connection.mediaConstraints.video = {
                            deviceId: lastVideoDevice.id
                        }
                    }
                    return;
                }

                if (connection.mediaConstraints.video == true) {
                    connection.mediaConstraints.video = {
                        mandatory: {},
                        optional: []
                    }
                }

                if (!connection.mediaConstraints.video.optional) {
                    connection.mediaConstraints.video.optional = [];
                }

                var optional = [{
                    sourceId: lastVideoDevice.id
                }];

                connection.mediaConstraints.video.optional = optional.concat(connection.mediaConstraints.video.optional);
            }
        });
    }

    connection.sdpConstraints = {
        mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true
        },
        optional: [{
            VoiceActivityDetection: false
        }]
    };

    connection.optionalArgument = {
        optional: [{
            DtlsSrtpKeyAgreement: true
        }, {
            googImprovedWifiBwe: true
        }, {
            googScreencastMinBitrate: 300
        }, {
            googIPv6: true
        }, {
            googDscp: true
        }, {
            googCpuUnderuseThreshold: 55
        }, {
            googCpuOveruseThreshold: 85
        }, {
            googSuspendBelowMinBitrate: true
        }, {
            googCpuOveruseDetection: true
        }],
        mandatory: {}
    };

    connection.iceServers = IceServersHandler.getIceServers(connection);

    connection.candidates = {
        host: true,
        stun: true,
        turn: true
    };

    connection.iceProtocols = {
        tcp: true,
        udp: true
    };

    // EVENTs
    connection.onopen = function(event) {
        if (!!connection.enableLogs) {
            console.info('Data connection has been opened between you & ', event.userid);
        }
    };

    connection.onclose = function(event) {
        if (!!connection.enableLogs) {
            console.warn('Data connection has been closed between you & ', event.userid);
        }
    };

    connection.onerror = function(error) {
        if (!!connection.enableLogs) {
            console.error(error.userid, 'data-error', error);
        }
    };

    connection.onmessage = function(event) {
        if (!!connection.enableLogs) {
            console.debug('data-message', event.userid, event.data);
        }
    };

    connection.send = function(data, remoteUserId) {
        connection.peers.send(data, remoteUserId);
    };

    connection.close = connection.disconnect = connection.leave = function() {
        beforeUnload(false, true);
    };

    connection.onstream = function(e) {
        var parentNode = connection.videosContainer;
        parentNode.insertBefore(e.mediaElement, parentNode.firstChild);

        if (!isMobileDevice) return;
        setTimeout(function() {
            e.mediaElement.play();
        }, 5000);
    };

    connection.onstreamended = function(e) {
        if (!e.mediaElement) {
            e.mediaElement = document.getElementById(e.streamid);
        }

        if (!e.mediaElement || !e.mediaElement.parentNode) {
            return;
        }

        e.mediaElement.parentNode.removeChild(e.mediaElement);
    };

    connection.direction = 'many-to-many';

    connection.removeStream = function(streamid) {
        var stream;
        connection.attachStreams.forEach(function(localStream) {
            if (localStream.id === streamid) {
                stream = localStream;
            }
        });

        if (!stream) {
            console.warn('No such stream exists.', streamid);
            return;
        }

        if (connection.removeStreams.indexOf(stream) === -1) {
            connection.removeStreams.push(stream);
            connection.peers.getAllParticipants().forEach(function(participant) {
                mPeer.renegotiatePeer(participant);
            });
        }
    };

    connection.addStream = function(session) {
        if (isData(session)) {
            connection.renegotiate();
            return;
        }

        if (!session.audio || session.video || session.screen) {
            if (session.screen) {
                connection.getScreenConstraints(function(error, screen_constraints) {
                    if (error) {
                        return alert(error);
                    }

                    invokeGetUserMedia({
                        video: screen_constraints
                    }, session.audio || session.video ? invokeGetUserMedia : false);
                });
            } else if (session.audio || session.video) {
                invokeGetUserMedia();
            }
        }

        function invokeGetUserMedia(localMediaConstraints, callback) {
            getUserMediaHandler({
                onGettingLocalMedia: function(stream) {
                    var videoConstraints = localMediaConstraints ? localMediaConstraints.video : connection.mediaConstraints;
                    if (videoConstraints) {
                        if (videoConstraints.mediaSource || videoConstraints.mozMediaSource) {
                            stream.isScreen = true;
                        } else if (videoConstraints.mandatory && videoConstraints.mandatory.chromeMediaSource) {
                            stream.isScreen = true;
                        }
                    }

                    if (!stream.isScreen) {
                        stream.isVideo = stream.getVideoTracks().length;
                        stream.isAudio = !stream.isVideo && stream.getAudioTracks().length;
                    }

                    mPeer.onGettingLocalMedia(stream);

                    if (session.streamCallback) {
                        session.streamCallback(stream);
                    }

                    if (callback) {
                        return callback();
                    }

                    connection.renegotiate();
                },
                onLocalMediaError: function(error, constraints) {
                    mPeer.onLocalMediaError(error, constraints);

                    if (constraints.audio && constraints.video && (error.name || '').toString().indexOf('DevicesNotFound') !== -1) {
                        constraints.video = false;
                        invokeGetUserMedia(constraints, callback);
                        return;
                    }

                    if (callback) {
                        return callback();
                    }

                    connection.renegotiate();
                },
                localMediaConstraints: localMediaConstraints || {
                    audio: session.audio ? connection.mediaConstraints.audio : false,
                    video: session.video ? connection.mediaConstraints.video : false
                }
            });
        }
    };

    function applyConstraints(stream, mediaConstraints) {
        if (!stream) {
            if (!!connection.enableLogs) {
                console.error('No stream to applyConstraints.');
            }
            return;
        }

        if (mediaConstraints.audio) {
            stream.getAudioTracks().forEach(function(track) {
                track.applyConstraints(mediaConstraints.audio);
            });
        }

        if (mediaConstraints.video) {
            stream.getVideoTracks().forEach(function(track) {
                track.applyConstraints(mediaConstraints.video);
            });
        }
    }

    connection.applyConstraints = function(mediaConstraints, streamid) {
        if (!MediaStreamTrack || !MediaStreamTrack.prototype.applyConstraints) {
            alert('track.applyConstraints is NOT supported in your browser.');
            return;
        }

        if (streamid) {
            var streams;
            if (connection.streamEvents[streamid]) {
                stream = connection.streamEvents[streamid].stream;
            }
            applyConstraints(stream, mediaConstraints);
            return;
        }

        connection.attachStreams.forEach(function(stream) {
            applyConstraints(stream, mediaConstraints);
        });
    };

    function replaceTrack(track, remoteUserId, isVideoTrack) {
        if (remoteUserId) {
            mPeer.replaceTrack(track, remoteUserId, isVideoTrack);
            return;
        }

        connection.peers.getAllParticipants().forEach(function(participant) {
            mPeer.replaceTrack(track, participant, isVideoTrack);
        });
    }

    connection.replaceTrack = function(session, remoteUserId, isVideoTrack) {
        session = session || {};

        if (!RTCPeerConnection.prototype.getSenders) {
            this.addStream(session);
            return;
        }

        if (session instanceof MediaStreamTrack) {
            replaceTrack(session, remoteUserId, isVideoTrack);
            return;
        }

        if (session instanceof MediaStream) {
            replaceTrack(session.getVideoTracks()[0], remoteUserId, isVideoTrack);
            return;
        }

        if (isData(session)) {
            throw 'connection.replaceTrack requires audio and/or video and/or screen.';
            return;
        }

        if (!session.audio || session.video || session.screen) {
            if (session.screen) {
                connection.getScreenConstraints(function(error, screen_constraints) {
                    if (error) {
                        return alert(error);
                    }

                    invokeGetUserMedia({
                        video: screen_constraints
                    }, session.audio || session.video ? invokeGetUserMedia : false);
                });
            } else if (session.audio || session.video) {
                invokeGetUserMedia();
            }
        }

        function invokeGetUserMedia(localMediaConstraints, callback) {
            getUserMediaHandler({
                onGettingLocalMedia: function(stream) {
                    mPeer.onGettingLocalMedia(stream);

                    if (callback) {
                        return callback();
                    }

                    connection.replaceTrack(stream, remoteUserId, isVideoTrack || session.video || session.screen);
                },
                onLocalMediaError: function(error, constraints) {
                    mPeer.onLocalMediaError(error, constraints);

                    if (constraints.audio && constraints.video && (error.name || '').toString().indexOf('DevicesNotFound') !== -1) {
                        constraints.video = false;
                        invokeGetUserMedia(constraints, callback);
                        return;
                    }

                    if (callback) {
                        callback();
                    }
                },
                localMediaConstraints: localMediaConstraints || {
                    audio: session.audio ? connection.mediaConstraints.audio : false,
                    video: session.video ? connection.mediaConstraints.video : false
                }
            });
        }
    };

    connection.resetTrack = function(remoteUsersIds, isVideoTrack) {
        if (!remoteUsersIds) {
            remoteUsersIds = connection.getAllParticipants();
        }

        if (typeof remoteUsersIds == 'string') {
            remoteUsersIds = [remoteUsersIds];
        }

        remoteUsersIds.forEach(function(participant) {
            var peer = connection.peers[participant].peer;

            if ((typeof isVideoTrack === 'undefined' || isVideoTrack === true) && peer.lastVideoTrack) {
                connection.replaceTrack(peer.lastVideoTrack, participant, true);
            }

            if ((typeof isVideoTrack === 'undefined' || isVideoTrack === false) && peer.lastAudioTrack) {
                connection.replaceTrack(peer.lastAudioTrack, participant, false);
            }
        });
    };

    connection.renegotiate = function(remoteUserId) {
        if (remoteUserId) {
            mPeer.renegotiatePeer(remoteUserId);
            return;
        }

        connection.peers.getAllParticipants().forEach(function(participant) {
            mPeer.renegotiatePeer(participant);
        });
    };

    function setStreamEndHandler(stream, isRemote) {
        isRemote = !!isRemote;

        if (stream.alreadySetEndHandler) {
            return;
        }
        stream.alreadySetEndHandler = true;
        if (!stream || !stream.addEventListener) return;

        stream.addEventListener('ended', function() {
            if (stream.idInstance) {
                currentUserMediaRequest.remove(stream.idInstance);
            }

            if (!isRemote) {
                delete connection.attachStreams[connection.attachStreams.indexOf(stream)];

                if (connection.removeStreams.indexOf(stream) === -1) {
                    connection.removeStreams.push(stream);
                }

                connection.attachStreams = removeNullEntries(connection.attachStreams);
                connection.removeStreams = removeNullEntries(connection.removeStreams);
                connection.observers.all();
            }

            // connection.renegotiate();

            var streamEvent = connection.streamEvents[stream.streamid];
            if (!streamEvent) {
                streamEvent = {
                    stream: stream,
                    streamid: stream.streamid,
                    type: isRemote ? 'remote' : 'local',
                    userid: connection.userid,
                    extra: connection.extra,
                    mediaElement: connection.streamEvents[stream.streamid] ? connection.streamEvents[stream.streamid].mediaElement : null
                };
            }

            if (streamEvent.userid === connection.userid && streamEvent.type === 'remote') {
                return;
            }

            connection.onstreamended(streamEvent);

            delete connection.streamEvents[stream.streamid];
        }, false);
    }

    connection.onMediaError = function(error, constraints) {
        if (!!connection.enableLogs) {
            console.error(error, constraints);
        }
    };

    connection.addNewBroadcaster = function(broadcasterId, userPreferences) {
        if (connection.broadcasters.length) {
            setTimeout(function() {
                mPeer.connectNewParticipantWithAllBroadcasters(broadcasterId, userPreferences, connection.broadcasters.join('|-,-|'));
            }, 10 * 1000);
        }

        if (!connection.session.oneway && !connection.session.broadcast && connection.direction === 'many-to-many' && connection.broadcasters.indexOf(broadcasterId) === -1) {
            connection.broadcasters.push(broadcasterId);
            keepNextBroadcasterOnServer();
        }
    };

    connection.autoCloseEntireSession = false;

    function keepNextBroadcasterOnServer() {
        if (!connection.isInitiator) return;

        if (connection.session.oneway || connection.session.broadcast || connection.direction !== 'many-to-many') {
            return;
        }

        var firstBroadcaster = connection.broadcasters[0];
        var otherBroadcasters = [];
        connection.broadcasters.forEach(function(broadcaster) {
            if (broadcaster !== firstBroadcaster) {
                otherBroadcasters.push(broadcaster);
            }
        });

        if (connection.autoCloseEntireSession) return;
        connection.shiftModerationControl(firstBroadcaster, otherBroadcasters, true);
    };

    connection.filesContainer = connection.videosContainer = document.body || document.documentElement;
    connection.isInitiator = false;

    connection.shareFile = mPeer.shareFile;
    if (typeof FileProgressBarHandler !== 'undefined') {
        FileProgressBarHandler.handle(connection);
    }

    if (typeof TranslationHandler !== 'undefined') {
        TranslationHandler.handle(connection);
    }

    connection.token = getRandomString;

    connection.onNewParticipant = function(participantId, userPreferences) {
        connection.acceptParticipationRequest(participantId, userPreferences);
    };

    connection.acceptParticipationRequest = function(participantId, userPreferences) {
        if (userPreferences.successCallback) {
            userPreferences.successCallback();
            delete userPreferences.successCallback;
        }

        mPeer.createNewPeer(participantId, userPreferences);
    };

    connection.onShiftedModerationControl = function(sender, existingBroadcasters) {
        connection.acceptModerationControl(sender, existingBroadcasters);
    };

    connection.acceptModerationControl = function(sender, existingBroadcasters) {
        connection.isInitiator = true; // NEW initiator!

        connection.broadcasters = existingBroadcasters;
        connection.peers.getAllParticipants().forEach(function(participant) {
            mPeer.onNegotiationNeeded({
                changedUUID: sender,
                oldUUID: connection.userid,
                newUUID: sender
            }, participant);
        });
        connection.userid = sender;
        socket.emit('changed-uuid', connection.userid);
    };

    connection.shiftModerationControl = function(remoteUserId, existingBroadcasters, firedOnLeave) {
        mPeer.onNegotiationNeeded({
            shiftedModerationControl: true,
            broadcasters: existingBroadcasters,
            firedOnLeave: !!firedOnLeave
        }, remoteUserId);
    };

    if (typeof StreamsHandler !== 'undefined') {
        connection.StreamsHandler = StreamsHandler;
    }

    connection.onleave = function(userid) {};

    connection.invokeSelectFileDialog = function(callback) {
        var selector = new FileSelector();
        selector.selectSingleFile(callback);
    };

    connection.getPublicModerators = function(userIdStartsWith, callback) {
        if (typeof userIdStartsWith === 'function') {
            callback = userIdStartsWith;
        }

        connectSocket(function(socket) {
            socket.emit(
                'get-public-moderators',
                typeof userIdStartsWith === 'string' ? userIdStartsWith : '',
                callback
            );
        });
    };

    connection.onmute = function(e) {
        if (!e.mediaElement) {
            return;
        }

        if (e.muteType === 'both' || e.muteType === 'video') {
            e.mediaElement.src = null;
            e.mediaElement.pause();
            e.mediaElement.poster = e.snapshot || 'https://cdn.webrtc-experiment.com/images/muted.png';
        } else if (e.muteType === 'audio') {
            e.mediaElement.muted = true;
        }
    };

    connection.onunmute = function(e) {
        if (!e.mediaElement) {
            return;
        }

        if (e.unmuteType === 'both' || e.unmuteType === 'video') {
            e.mediaElement.poster = null;
            e.mediaElement.src = URL.createObjectURL(e.stream);
            e.mediaElement.play();
        } else if (e.unmuteType === 'audio') {
            e.mediaElement.muted = false;
        }
    };

    connection.onExtraDataUpdated = function(event) {
        event.status = 'online';
        connection.onUserStatusChanged(event, true);
    };

    connection.onJoinWithPassword = function(remoteUserId) {
        console.warn(remoteUserId, 'is password protected. Please join with password.');
    };

    connection.onInvalidPassword = function(remoteUserId, oldPassword) {
        console.warn(remoteUserId, 'is password protected. Please join with valid password. Your old password', oldPassword, 'is wrong.');
    };

    connection.onPasswordMaxTriesOver = function(remoteUserId) {
        console.warn(remoteUserId, 'is password protected. Your max password tries exceeded the limit.');
    };

    connection.getAllParticipants = function(sender) {
        return connection.peers.getAllParticipants(sender);
    };

    if (typeof StreamsHandler !== 'undefined') {
        StreamsHandler.onSyncNeeded = function(streamid, action, type) {
            connection.peers.getAllParticipants().forEach(function(participant) {
                mPeer.onNegotiationNeeded({
                    streamid: streamid,
                    action: action,
                    streamSyncNeeded: true,
                    type: type || 'both'
                }, participant);
            });
        };
    }

    connection.connectSocket = function(callback) {
        connectSocket(callback);
    };

    connection.getSocket = function(callback) {
        if (!socket) {
            connectSocket(callback);
        } else if (callback) {
            callback(socket);
        }

        return socket;
    };

    connection.getRemoteStreams = mPeer.getRemoteStreams;

    var skipStreams = ['selectFirst', 'selectAll', 'forEach'];

    connection.streamEvents = {
        selectFirst: function(options) {
            if (!options) {
                // in normal conferencing, it will always be "local-stream"
                var firstStream;
                for (var str in connection.streamEvents) {
                    if (skipStreams.indexOf(str) === -1 && !firstStream) {
                        firstStream = connection.streamEvents[str];
                        continue;
                    }
                }
                return firstStream;
            }
        },
        selectAll: function() {}
    };

    connection.socketURL = '@@socketURL'; // generated via config.json
    connection.socketMessageEvent = '@@socketMessageEvent'; // generated via config.json
    connection.socketCustomEvent = '@@socketCustomEvent'; // generated via config.json
    connection.DetectRTC = DetectRTC;

    connection.onUserStatusChanged = function(event, dontWriteLogs) {
        if (!!connection.enableLogs && !dontWriteLogs) {
            console.info(event.userid, event.status);
        }
    };

    connection.getUserMediaHandler = getUserMediaHandler;
    connection.multiPeersHandler = mPeer;
    connection.enableLogs = true;
    connection.setCustomSocketHandler = function(customSocketHandler) {
        if (typeof SocketConnection !== 'undefined') {
            SocketConnection = customSocketHandler;
        }
    };

    // default value is 15k because Firefox's receiving limit is 16k!
    // however 64k works chrome-to-chrome
    connection.chunkSize = 65 * 1000;

    connection.maxParticipantsAllowed = 1000;

    // eject or leave single user
    connection.disconnectWith = mPeer.disconnectWith;

    connection.checkPresence = function(remoteUserId, callback) {
        mPeer.onNegotiationNeeded({
            detectPresence: true,
            userid: (remoteUserId || connection.sessionid) + ''
        }, 'system', callback);
    };

    connection.onReadyForOffer = function(remoteUserId, userPreferences) {
        connection.multiPeersHandler.createNewPeer(remoteUserId, userPreferences);
    };

    connection.setUserPreferences = function(userPreferences) {
        if (connection.dontAttachStream) {
            userPreferences.dontAttachLocalStream = true;
        }

        if (connection.dontGetRemoteStream) {
            userPreferences.dontGetRemoteStream = true;
        }

        return userPreferences;
    };

    connection.updateExtraData = function() {
        socket.emit('extra-data-updated', connection.extra);
    };

    connection.enableScalableBroadcast = false;
    connection.maxRelayLimitPerUser = 3; // each broadcast should serve only 3 users

    connection.dontCaptureUserMedia = false;
    connection.dontAttachStream = false;
    connection.dontGetRemoteStream = false;

    connection.onReConnecting = function(event) {
        if (connection.enableLogs) {
            console.info('ReConnecting with', event.userid, '...');
        }
    };

    connection.beforeAddingStream = function(stream) {
        return stream;
    };

    connection.beforeRemovingStream = function(stream) {
        return stream;
    };

    if (typeof isChromeExtensionAvailable !== 'undefined') {
        connection.checkIfChromeExtensionAvailable = isChromeExtensionAvailable;
    }

    if (typeof isFirefoxExtensionAvailable !== 'undefined') {
        connection.checkIfChromeExtensionAvailable = isFirefoxExtensionAvailable;
    }

    if (typeof getChromeExtensionStatus !== 'undefined') {
        connection.getChromeExtensionStatus = getChromeExtensionStatus;
    }

    connection.getScreenConstraints = function(callback) {
        getScreenConstraints(function(error, screen_constraints) {
            if (!error) {
                screen_constraints = connection.modifyScreenConstraints(screen_constraints);
                callback(error, screen_constraints);
            }
        });
    };

    connection.modifyScreenConstraints = function(screen_constraints) {
        return screen_constraints;
    };

    connection.onPeerStateChanged = function(state) {
        if (connection.enableLogs) {
            if (state.iceConnectionState.search(/closed|failed/gi) !== -1) {
                console.error('Peer connection is closed between you & ', state.userid, state.extra, 'state:', state.iceConnectionState);
            }
        }
    };

    connection.isOnline = true;

    listenEventHandler('online', function() {
        connection.isOnline = true;
    });

    listenEventHandler('offline', function() {
        connection.isOnline = false;
    });

    connection.getExtraData = function(remoteUserId) {
        if (!remoteUserId) throw 'remoteUserId is required.';
        if (!connection.peers[remoteUserId]) return {};
        return connection.peers[remoteUserId].extra;
    };

    if (!!forceOptions.autoOpenOrJoin) {
        connection.openOrJoin(connection.sessionid);
    }
}
