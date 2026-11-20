// Local Look Around coverage probe. A returned snapshot still needs an independent camera solve.
import AppKit
import MapKit

guard CommandLine.arguments.count == 4,
      let lat = Double(CommandLine.arguments[1]), let lon = Double(CommandLine.arguments[2]) else {
    exit(2)
}
let output = URL(fileURLWithPath: CommandLine.arguments[3])
let began = Date()
let request = MKLookAroundSceneRequest(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon))
request.getSceneWithCompletionHandler { scene, _ in
    guard let scene else { print("no scene"); exit(1) }
    let options = MKLookAroundSnapshotter.Options()
    options.size = CGSize(width: 960, height: 540)
    options.pointOfInterestFilter = .excludingAll
    MKLookAroundSnapshotter(scene: scene, options: options).getSnapshotWithCompletionHandler { snapshot, _ in
        guard let tiff = snapshot?.image.tiffRepresentation,
              let jpeg = NSBitmapImageRep(data: tiff)?.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) else { exit(1) }
        do { try jpeg.write(to: output, options: .atomic) } catch { exit(1) }
        print("snapshot", jpeg.count, "bytes in", Date().timeIntervalSince(began), "s")
        exit(0)
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { print("scene request timed out"); exit(1) }
RunLoop.main.run()
