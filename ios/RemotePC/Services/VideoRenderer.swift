import AVFoundation
import CoreMedia
import UIKit

/// Decodes the agent's H.264 stream with the hardware decoder (via AVSampleBufferDisplayLayer).
/// Frames arrive as length-prefixed NAL units, one access unit per message.
@MainActor
final class VideoRenderer {
    let layer = AVSampleBufferDisplayLayer()
    var onNeedKeyframe: (() -> Void)?

    private var format: CMVideoFormatDescription?
    private var sps = Data()
    private var pps = Data()
    private var waitingForKeyframe = true
    private var lastKeyframeRequest = Date.distantPast

    init() {
        layer.videoGravity = .resizeAspect
        layer.backgroundColor = UIColor.black.cgColor
    }

    func reset() {
        layer.sampleBufferRenderer.flush()
        format = nil
        sps = Data()
        pps = Data()
        waitingForKeyframe = true
    }

    func setParameterSets(sps newSps: Data, pps newPps: Data) {
        guard !newSps.isEmpty, !newPps.isEmpty else { return }
        if newSps == sps && newPps == pps && format != nil { return }
        var description: CMFormatDescription?
        let status = newSps.withUnsafeBytes { (spsRaw: UnsafeRawBufferPointer) -> OSStatus in
            newPps.withUnsafeBytes { (ppsRaw: UnsafeRawBufferPointer) -> OSStatus in
                guard let spsBase = spsRaw.bindMemory(to: UInt8.self).baseAddress,
                      let ppsBase = ppsRaw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                let pointers: [UnsafePointer<UInt8>] = [spsBase, ppsBase]
                let sizes: [Int] = [newSps.count, newPps.count]
                return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: kCFAllocatorDefault,
                    parameterSetCount: 2,
                    parameterSetPointers: pointers,
                    parameterSetSizes: sizes,
                    nalUnitHeaderLength: 4,
                    formatDescriptionOut: &description
                )
            }
        }
        guard status == noErr, let description else { return }
        sps = newSps
        pps = newPps
        format = description
        layer.sampleBufferRenderer.flush()
        waitingForKeyframe = true
    }

    /// `avcc`: NAL units each prefixed with a 4-byte big-endian length.
    func decode(avcc: Data, keyframe: Bool) {
        var slices = Data()
        var inBandSps: Data?
        var inBandPps: Data?
        var offset = avcc.startIndex
        while offset + 4 <= avcc.endIndex {
            let length = Int(avcc[offset]) << 24 | Int(avcc[offset + 1]) << 16 | Int(avcc[offset + 2]) << 8 | Int(avcc[offset + 3])
            let start = offset + 4
            let end = start + length
            guard length > 0, end <= avcc.endIndex else { break }
            let type = avcc[start] & 0x1F
            switch type {
            case 7: inBandSps = avcc.subdata(in: start..<end)
            case 8: inBandPps = avcc.subdata(in: start..<end)
            case 9: break // access unit delimiter
            default: slices.append(avcc.subdata(in: offset..<end))
            }
            offset = end
        }
        if let inBandSps, let inBandPps { setParameterSets(sps: inBandSps, pps: inBandPps) }
        guard let format, !slices.isEmpty else { return }
        if waitingForKeyframe {
            guard keyframe else {
                requestKeyframe()
                return
            }
            waitingForKeyframe = false
        }

        let renderer = layer.sampleBufferRenderer
        if renderer.status == .failed {
            renderer.flush()
            waitingForKeyframe = true
            requestKeyframe()
            return
        }

        var block: CMBlockBuffer?
        let count = slices.count
        guard CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: count,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: count,
            flags: 0,
            blockBufferOut: &block
        ) == kCMBlockBufferNoErr, let block else { return }
        let copied = slices.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> OSStatus in
            guard let base = raw.baseAddress else { return -1 }
            return CMBlockBufferReplaceDataBytes(with: base, blockBuffer: block, offsetIntoDestination: 0, dataLength: count)
        }
        guard copied == kCMBlockBufferNoErr else { return }

        var sample: CMSampleBuffer?
        let sizes: [Int] = [count]
        guard CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: block,
            formatDescription: format,
            sampleCount: 1,
            sampleTimingEntryCount: 0,
            sampleTimingArray: nil,
            sampleSizeEntryCount: 1,
            sampleSizeArray: sizes,
            sampleBufferOut: &sample
        ) == noErr, let sample else { return }

        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(
                dict,
                Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
            )
        }
        renderer.enqueue(sample)
    }

    private func requestKeyframe() {
        guard Date().timeIntervalSince(lastKeyframeRequest) > 3 else { return }
        lastKeyframeRequest = Date()
        onNeedKeyframe?()
    }
}
