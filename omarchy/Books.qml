import QtQuick
import Quickshell
import qs.Ui
import qs.Commons

BarWidget {
  id: root
  moduleName: "skrivist.books"
  readonly property string readerUrl: String(setting("url", "https://books.skriv.ist"))
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰂺"
    tooltipText: "Skrivist Books"
    onPressed: {
      if (/^https?:\/\//.test(root.readerUrl))
        Quickshell.execDetached(["omarchy", "launch", "webapp", root.readerUrl])
    }
  }
}
