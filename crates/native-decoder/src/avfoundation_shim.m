#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <VideoToolbox/VideoToolbox.h>
#import "avfoundation_shim.h"

// C interface for AVFoundation operations
// This shim provides a clean C API that Rust can call

static inline void log_exception(const char* func, NSException* e) {
  NSLog(@"[shim] EXC in %s: %@ — %@", [NSString stringWithUTF8String:func], e.name, e.reason);
}

static void AVFUncaughtHandler(NSException *e) {
  NSLog(@"[shim][UNCAUGHT] %@ — %@", e.name, e.reason);
  NSLog(@"[shim][UNCAUGHT] callstack:\n%@", [e callStackSymbols]);
}

void avf_install_uncaught_exception_handler(void) {
  @autoreleasepool {
    NSSetUncaughtExceptionHandler(&AVFUncaughtHandler);
    NSLog(@"[shim] Uncaught exception handler installed");
  }
}

struct AVFoundationContext {
    void* asset;
    void* reader;
    void* track_output;
    int32_t time_scale;
    double nominal_fps;
    double timecode_base;
};

// Create AVFoundation context from video file path
AVFoundationContext* avfoundation_create_context(const char* video_path) {
    @autoreleasepool {
        @try {
            NSString* path = [NSString stringWithUTF8String:video_path];
            NSURL* url = [NSURL fileURLWithPath:path];
            
            if (!url) {
                NSLog(@"Failed to create URL from path: %s", video_path);
                return NULL;
            }
            
            AVURLAsset* asset = [AVURLAsset assetWithURL:url];
            if (!asset) {
                NSLog(@"Failed to create AVURLAsset from URL: %@", url);
                return NULL;
            }
            
            // Get video tracks
            NSArray* videoTracks = [asset tracksWithMediaType:AVMediaTypeVideo];
            if ([videoTracks count] == 0) {
                NSLog(@"No video tracks found in asset");
                return NULL;
            }
            
            AVAssetTrack* videoTrack = [videoTracks objectAtIndex:0];
            if (!videoTrack) {
                NSLog(@"Failed to get video track");
                return NULL;
            }
            
            // Create asset reader
            NSError* error = nil;
            AVAssetReader* reader = [AVAssetReader assetReaderWithAsset:asset error:&error];
            if (!reader) {
                NSLog(@"Failed to create AVAssetReader: %@", error);
                return NULL;
            }
            
            // Create track output for compressed samples (outputSettings: nil)
            AVAssetReaderTrackOutput* trackOutput = [AVAssetReaderTrackOutput 
                assetReaderTrackOutputWithTrack:videoTrack 
                outputSettings:nil];
            
            if (!trackOutput) {
                NSLog(@"Failed to create AVAssetReaderTrackOutput");
                return NULL;
            }
            
            [reader addOutput:trackOutput];
            
            // Start reading
            BOOL ok = [reader startReading];
            if (!ok) {
                NSLog(@"[shim] AVAssetReader failed to start: %@", reader.error);
                return NULL;
            }
            
            // Allocate context
            AVFoundationContext* ctx = malloc(sizeof(AVFoundationContext));
            if (!ctx) {
                NSLog(@"Failed to allocate AVFoundationContext");
                return NULL;
            }
            
            // Store references (retain them)
            ctx->asset = (__bridge_retained void*)asset;
            ctx->reader = (__bridge_retained void*)reader;
            ctx->track_output = (__bridge_retained void*)trackOutput;
            ctx->time_scale = videoTrack.naturalTimeScale;
            ctx->nominal_fps = videoTrack.nominalFrameRate;
            ctx->timecode_base = 0.0; // Will be set based on first frame
            
            NSLog(@"Created AVFoundation context: time_scale=%d, fps=%.2f", 
                  ctx->time_scale, ctx->nominal_fps);
            
            return ctx;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return NULL;
        }
    }
}

// Read next sample buffer
void* avfoundation_read_next_sample(AVFoundationContext* ctx) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->reader || !ctx->track_output) {
                return NULL;
            }
            
            AVAssetReader* reader = (__bridge AVAssetReader*)ctx->reader;
            AVAssetReaderTrackOutput* trackOutput = (__bridge AVAssetReaderTrackOutput*)ctx->track_output;
            
            if (reader.status != AVAssetReaderStatusReading) {
                NSLog(@"Reader not in reading status: %ld", (long)reader.status);
                return NULL;
            }
            
            CMSampleBufferRef sampleBuffer = [trackOutput copyNextSampleBuffer];
            if (sampleBuffer) {
                // Set timecode base from first frame
                if (ctx->timecode_base == 0.0) {
                    CMTime presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
                    ctx->timecode_base = CMTimeGetSeconds(presentationTime);
                }
            }
            
            return sampleBuffer;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return NULL;
        }
    }
}

// Seek to timestamp
int avfoundation_seek_to(AVFoundationContext* ctx, double timestamp_sec) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->asset || !ctx->reader) {
                return -1;
            }
            
            AVURLAsset* asset = (__bridge AVURLAsset*)ctx->asset;
            AVAssetReader* reader = (__bridge AVAssetReader*)ctx->reader;
            
            // Cancel current reading
            [reader cancelReading];
            
            // Create new reader for the seek position
            NSError* error = nil;
            AVAssetReader* newReader = [AVAssetReader assetReaderWithAsset:asset error:&error];
            if (!newReader) {
                NSLog(@"Failed to create new AVAssetReader for seek: %@", error);
                return -1;
            }
            
            // Get video track
            NSArray* videoTracks = [asset tracksWithMediaType:AVMediaTypeVideo];
            if ([videoTracks count] == 0) {
                NSLog(@"No video tracks found for seek");
                return -1;
            }
            
            AVAssetTrack* videoTrack = [videoTracks objectAtIndex:0];
            
            // Create time range for seek
            CMTime startTime = CMTimeMakeWithSeconds(timestamp_sec, ctx->time_scale);
            CMTime duration = CMTimeMakeWithSeconds(2.0, ctx->time_scale); // 2 second range
            CMTimeRange timeRange = CMTimeRangeMake(startTime, duration);
            
            // Set time range on the reader
            newReader.timeRange = timeRange;
            
            // Create track output for compressed samples (outputSettings: nil)
            AVAssetReaderTrackOutput* trackOutput = [AVAssetReaderTrackOutput 
                assetReaderTrackOutputWithTrack:videoTrack 
                outputSettings:nil];
            
            [newReader addOutput:trackOutput];
            
            // Start reading
            BOOL ok = [newReader startReading];
            if (!ok) {
                NSLog(@"[shim] seek startReading failed: %@", newReader.error);
                return -1;
            }
            
            // Update context
            ctx->reader = (__bridge_retained void*)newReader;
            ctx->track_output = (__bridge_retained void*)trackOutput;
            
            NSLog(@"Seeked to timestamp: %.3f", timestamp_sec);
            return 0;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return -1000;
        }
    }
}

// Get reader status
int avfoundation_get_reader_status(AVFoundationContext* ctx) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->reader) {
                return -1;
            }
            
            AVAssetReader* reader = (__bridge AVAssetReader*)ctx->reader;
            return (int)reader.status;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return -1000;
        }
    }
}

// Release AVFoundation context
void avfoundation_release_context(AVFoundationContext* ctx) {
    @autoreleasepool {
        @try {
            if (!ctx) {
                return;
            }
            
            if (ctx->asset) {
                CFRelease(ctx->asset);
                ctx->asset = NULL;
            }
            
            if (ctx->reader) {
                CFRelease(ctx->reader);
                ctx->reader = NULL;
            }
            
            if (ctx->track_output) {
                CFRelease(ctx->track_output);
                ctx->track_output = NULL;
            }
            
            free(ctx);
        } @catch (NSException* e) {
            log_exception(__func__, e);
        }
    }
}

int avfoundation_get_video_properties(AVFoundationContext* ctx, VideoPropertiesC* props) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->asset || !props) {
                return -1;
            }
            
            AVURLAsset* asset = (__bridge AVURLAsset*)ctx->asset;
            NSArray* videoTracks = [asset tracksWithMediaType:AVMediaTypeVideo];
            
            if ([videoTracks count] == 0) {
                return -1;
            }
            
            AVAssetTrack* videoTrack = [videoTracks objectAtIndex:0];
            
            props->width = (int32_t)videoTrack.naturalSize.width;
            props->height = (int32_t)videoTrack.naturalSize.height;
            props->duration = CMTimeGetSeconds(asset.duration);
            props->frame_rate = videoTrack.nominalFrameRate;
            props->time_scale = videoTrack.naturalTimeScale;
            
            return 0;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return -1000;
        }
    }
}

// Get CMFormatDescriptionRef for the video track
void* avfoundation_copy_track_format_desc(AVFoundationContext* ctx) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->asset) {
                return NULL;
            }
            
            AVURLAsset* asset = (__bridge AVURLAsset*)ctx->asset;
            NSArray* videoTracks = [asset tracksWithMediaType:AVMediaTypeVideo];
            
            if ([videoTracks count] == 0) {
                NSLog(@"No video tracks found for format description");
                return NULL;
            }
            
            AVAssetTrack* videoTrack = [videoTracks objectAtIndex:0];
            id fmtObj = [videoTrack.formatDescriptions lastObject];
            if (!fmtObj) {
                NSLog(@"No format description found for video track");
                return NULL;
            }
            CMFormatDescriptionRef fmt = (__bridge CMFormatDescriptionRef)fmtObj;
            /* Retain before returning across C boundary */
            CFRetain(fmt);
            
            NSLog(@"Retrieved CMFormatDescriptionRef for track: %dx%d, media type: %s", 
                  (int)videoTrack.naturalSize.width, 
                  (int)videoTrack.naturalSize.height,
                  CMFormatDescriptionGetMediaType(fmt) == kCMMediaType_Video ? "video" : "unknown");
            
            return (void*)fmt;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return NULL;
        }
    }
}

// Create destination attributes for VideoToolbox decompression
void* avfoundation_create_destination_attributes(void) {
    @autoreleasepool {
        @try {
            // Request NV12 format (420YpCbCr8BiPlanarVideoRange)
            NSDictionary* attrs = @{
                (NSString*)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)
            };
            return (__bridge_retained CFDictionaryRef)attrs;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return NULL;
        }
    }
}

// NEW: explicit start + first pts (debug)
int avfoundation_start_reader(AVFoundationContext* ctx) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->reader) return -1;
            AVAssetReader* reader = (__bridge AVAssetReader*)ctx->reader;
            if ([reader startReading]) return 0;
            NSLog(@"[shim] startReading failed: %@", reader.error);
            return -2;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return -1000;
        }
    }
}

double avfoundation_peek_first_sample_pts(AVFoundationContext* ctx) {
    @autoreleasepool {
        @try {
            if (!ctx || !ctx->track_output) return -1.0;
            AVAssetReaderTrackOutput* trackOutput = (__bridge AVAssetReaderTrackOutput*)ctx->track_output;
            CMSampleBufferRef sb = [trackOutput copyNextSampleBuffer];
            if (!sb) return -2.0;
            CMTime pts = CMSampleBufferGetPresentationTimeStamp(sb);
            double sec = CMTimeGetSeconds(pts);
            CFRelease(sb);
            return sec;
        } @catch (NSException* e) {
            log_exception(__func__, e);
            return -1000.0;
        }
    }
}

// VT wrapper functions
OSStatus avf_vt_create_session(CMFormatDescriptionRef fmt,
                               CFDictionaryRef dest_attrs,
                               VTDecompressionOutputCallback cb,
                               void *refcon,
                               VTDecompressionSessionRef *out_sess) {
  @autoreleasepool {
    @try {
      VTDecompressionOutputCallbackRecord rec = { .decompressionOutputCallback = cb,
                                                  .decompressionOutputRefCon  = refcon };
      return VTDecompressionSessionCreate(kCFAllocatorDefault,
                                          fmt,
                                          /*decoderSpecification*/ NULL,
                                          dest_attrs,
                                          &rec,
                                          out_sess);
    } @catch (NSException* e) {
      log_exception(__func__, e);
      return -10000; // custom OSStatus to indicate exception
    }
  }
}

OSStatus avf_vt_decode_frame(VTDecompressionSessionRef sess, CMSampleBufferRef sb) {
  @autoreleasepool {
    @try {
      return VTDecompressionSessionDecodeFrame(sess,
                                               sb,
                                               kVTDecodeFrame_EnableAsynchronousDecompression,
                                               sb, /* sourceFrameRefcon (we don't use it) */
                                               NULL);
    } @catch (NSException* e) {
      log_exception(__func__, e);
      return -10001;
    }
  }
}

void avf_vt_wait_async(VTDecompressionSessionRef sess) {
  @autoreleasepool {
    @try { VTDecompressionSessionWaitForAsynchronousFrames(sess); }
    @catch (NSException* e) { log_exception(__func__, e); }
  }
}

void avf_vt_invalidate(VTDecompressionSessionRef sess) {
  @autoreleasepool {
    @try { VTDecompressionSessionInvalidate(sess); }
    @catch (NSException* e) { log_exception(__func__, e); }
  }
}

