#!/usr/bin/env python3
"""
BH1750FVI GY-30 零件打包工具

用途: 将 .fzp 和 .svg 文件打包成 .fzpz 格式（ZIP压缩包）
这样可以直接导入到 Circuit Designer 应用中

使用方法:
    python3 package_part.py

前置条件:
    - Data/ 目录中包含 BH1750FVI_GY-30.fzp
    - Data/ 目录中包含 svg.breadboard.BH1750FVI_GY-30_72e7c06833f6f19b3443e344cc3aebba_1_breadboard.svg
"""

import zipfile
import os
import sys
from pathlib import Path

def package_part(fzp_file, svg_file, output_file):
    """
    将 .fzp 和 .svg 文件打包成 .fzpz 文件
    
    Args:
        fzp_file: .fzp XML 文件路径
        svg_file: .svg 文件路径
        output_file: 输出 .fzpz 文件路径
    
    Returns:
        bool: 打包成功返回 True，失败返回 False
    """
    try:
        # 验证输入文件存在
        if not os.path.exists(fzp_file):
            print(f"❌ 错误: 找不到 .fzp 文件: {fzp_file}")
            return False
        
        if not os.path.exists(svg_file):
            print(f"❌ 错误: 找不到 .svg 文件: {svg_file}")
            return False
        
        # 创建 ZIP 文件
        with zipfile.ZipFile(output_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 添加 .fzp 文件
            fzp_basename = os.path.basename(fzp_file)
            zf.write(fzp_file, arcname=fzp_basename)
            print(f"✅ 已添加: {fzp_basename}")
            
            # 添加 .svg 文件
            svg_basename = os.path.basename(svg_file)
            zf.write(svg_file, arcname=svg_basename)
            print(f"✅ 已添加: {svg_basename}")
        
        print(f"\n✅ 成功打包: {output_file}")
        print(f"📦 文件大小: {os.path.getsize(output_file) / 1024:.2f} KB")
        return True
        
    except Exception as e:
        print(f"❌ 打包失败: {e}")
        return False


def main():
    """主函数"""
    # 定义文件路径
    data_dir = Path(__file__).parent / "Data"
    
    fzp_file = data_dir / "BH1750FVI_GY-30.fzp"
    svg_file = data_dir / "svg.breadboard.BH1750FVI_GY-30_72e7c06833f6f19b3443e344cc3aebba_1_breadboard.svg"
    output_file = data_dir / "BH1750FVI_GY-30.fzpz"
    
    print("🔧 BH1750FVI GY-30 零件打包工具")
    print("=" * 50)
    
    # 执行打包
    success = package_part(str(fzp_file), str(svg_file), str(output_file))
    
    if success:
        print("\n📋 打包完成！")
        print(f"💾 输出文件: {output_file}")
        print(f"\n下一步:")
        print("1. 打开 Circuit Designer 应用")
        print("2. 点击'导入零件'按钮")
        print(f"3. 选择: {output_file}")
        print("4. 零件将被加载到库中")
        return 0
    else:
        return 1


if __name__ == "__main__":
    sys.exit(main())
