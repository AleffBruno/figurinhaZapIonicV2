import { Component } from "@angular/core";
import {
  AlertController,
  IonicPage,
  Platform,
} from "ionic-angular";

declare let admob: any;

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
    this.showAdmobBannerAds();
  }

  showAdmobBannerAds() {

    if(!this.platform.is('cordova')) {
      return;
    }

    let adConfig: any = {
      // adUnitId: 'ca-app-pub-3940256099942544/9214589741', //test banner adaptativo
      adUnitId: 'ca-app-pub-1805020580779621/4586014783',
    }

    const banner = new admob.BannerAd(adConfig);
    banner.show();
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

  presentSticker(pack: StickerPack, sticker: Sticker) {
    const url = this.stickerUrl(pack, sticker);
    const alt = sticker.accessibility_text || sticker.image_file;
    this.alertCtrl.create({
      message: `<img src="${url}" alt="${alt}"` +
        ` style="display:block;margin:0 auto;max-width:256px;width:100%;height:auto;border-radius:8px;">`,
      buttons: ["OK"],
      enableBackdropDismiss: true,
    }).present();
  }

  private showAlert(title: string, message: string) {
    this.alertCtrl.create({
      title,
      message,
      buttons: ["OK"],
    }).present();
  }
}
