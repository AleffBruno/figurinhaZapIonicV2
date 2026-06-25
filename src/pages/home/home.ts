import { Component } from "@angular/core";
import {
  AlertController,
  IonicPage,
  Platform,
} from "ionic-angular";

declare const WhatsAppStickers: any;

interface Sticker {
  image_file: string;
  emojis: string[];
  accessibility_text?: string;
}

interface StickerPack {
  identifier: string;
  name: string;
  publisher: string;
  tray_image_file: string;
  animated_sticker_pack?: boolean;
  stickers: Sticker[];
}

interface StickerManifest {
  sticker_packs: StickerPack[];
}

@IonicPage()
@Component({
  selector: "page-home",
  templateUrl: "home.html",
})
export class HomePage {
  packs: StickerPack[] = [];
  expandedPack: string | null = null;
  loading = true;
  stickerSize = 104;

  constructor(
    private alertCtrl: AlertController,
    readonly platform: Platform,
  ) { }

  ionViewDidLoad() {
    this.loadPacks();
  }

  private async loadPacks() {
    try {
      const res = await fetch("contents.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest: StickerManifest = await res.json();
      this.packs = manifest.sticker_packs || [];
    } catch (e) {
      this.packs = [];
    } finally {
      this.loading = false;
    }
  }

  trayUrl(pack: StickerPack): string {
    return `assets/imgs/${pack.identifier}/${pack.tray_image_file}`;
  }

  stickerUrl(pack: StickerPack, sticker: Sticker): string {
    return `assets/imgs/${pack.identifier}/${sticker.image_file}`;
  }

  togglePack(pack: StickerPack) {
    this.expandedPack = this.expandedPack === pack.identifier ? null : pack.identifier;
  }

  isExpanded(pack: StickerPack): boolean {
    return this.expandedPack === pack.identifier;
  }

  isAnimated(pack: StickerPack): boolean {
    return pack.animated_sticker_pack === true;
  }

  addToWhatsApp(pack: StickerPack, event: Event) {
    event.stopPropagation();
    if (typeof WhatsAppStickers === "undefined") {
      this.showAlert("Plugin indisponivel", "Execute em um aparelho Android com o app instalado.");
      return;
    }

    WhatsAppStickers.addToWhatsApp(
      JSON.stringify({ identifier: pack.identifier, name: pack.name }),
      () => this.showAlert("Sucesso", `"${pack.name}" adicionado ao WhatsApp.`),
      (error: string) => {
        if (error === "sticker_pack_not_added") return;
        this.showAlert("Nao foi possivel adicionar", error || "Verifique se o WhatsApp esta instalado.");
      },
    );
  }

  private showAlert(title: string, message: string) {
    this.alertCtrl.create({
      title,
      message,
      buttons: ["OK"],
    }).present();
  }
}
